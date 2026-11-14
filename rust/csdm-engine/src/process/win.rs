//! The Win32 calls of the batch run, each behind a small safe function: the job object that holds
//! the whole CLI tree, process snapshots (find / kill by name, resume a suspended child), and the
//! window calls of the CS2 watcher (3.5 `cs2_send_to_back`, eight calls).

use std::io;
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM, WAIT_OBJECT_0};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, Thread32First, Thread32Next, PROCESSENTRY32W, TH32CS_SNAPPROCESS, TH32CS_SNAPTHREAD,
    THREADENTRY32,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation, QueryInformationJobObject,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, OpenThread, QueryFullProcessImageNameW, ResumeThread, TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, THREAD_SUSPEND_RESUME,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

/// `ResumeThread` failure value.
const RESUME_FAILED: u32 = u32::MAX;
/// Longest window title read (characters).
const TITLE_CHARS: usize = 512;

/// An owned kernel handle, closed once.
struct Owned(HANDLE);

impl Owned {
    fn new(h: HANDLE) -> io::Result<Owned> {
        if h.is_null() || h == INVALID_HANDLE_VALUE {
            Err(io::Error::last_os_error())
        } else {
            Ok(Owned(h))
        }
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the handle came from a successful Win32 call and is closed exactly once.
        unsafe { CloseHandle(self.0) };
    }
}

fn check(ok: i32) -> io::Result<()> {
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

/// A job object with `KILL_ON_JOB_CLOSE`: every process in it dies with it, at the latest when the
/// app lets it go (or itself dies).
pub struct Job(Owned);

// SAFETY: a job handle is a kernel object; every call below is thread-safe on it.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl Job {
    pub fn new() -> io::Result<Job> {
        // SAFETY: no attributes, no name.
        let job = Owned::new(unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) })?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        // SAFETY: `info` lives through the call and `size` is its size.
        check(unsafe { SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, (&raw const info).cast(), size) })?;
        Ok(Job(job))
    }

    /// Puts `child` (still suspended) in the job; everything it starts afterwards is in it too.
    pub fn assign(&self, child: &Child) -> io::Result<()> {
        // SAFETY: both handles are valid for the call.
        check(unsafe { AssignProcessToJobObject(self.0 .0, child.as_raw_handle() as HANDLE) })
    }

    /// Kills every process of the job (the whole CLI tree).
    pub fn terminate(&self, exit_code: u32) -> io::Result<()> {
        // SAFETY: valid job handle.
        check(unsafe { TerminateJobObject(self.0 .0, exit_code) })
    }

    /// Processes of the job still alive.
    pub fn active_processes(&self) -> io::Result<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let size = std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32;
        // SAFETY: `info` is writable and `size` is its size.
        check(unsafe { QueryInformationJobObject(self.0 .0, JobObjectBasicAccountingInformation, (&raw mut info).cast(), size, std::ptr::null_mut()) })?;
        Ok(info.ActiveProcesses)
    }
}

/// Resumes the main thread of a child created with `CREATE_SUSPENDED` (std gives no thread handle:
/// the child's only thread is found in a thread snapshot).
pub fn resume_main_thread(pid: u32) -> io::Result<()> {
    // SAFETY: snapshot of every thread; handle owned below.
    let snap = Owned::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) })?;
    let mut entry = THREADENTRY32 { dwSize: std::mem::size_of::<THREADENTRY32>() as u32, ..Default::default() };
    // SAFETY: `entry.dwSize` is set as the API requires.
    let mut more = unsafe { Thread32First(snap.0, &mut entry) } != 0;
    let mut resumed = 0;
    while more {
        if entry.th32OwnerProcessID == pid {
            // SAFETY: plain open of a thread id from the snapshot.
            let thread = Owned::new(unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) })?;
            // SAFETY: valid thread handle.
            if unsafe { ResumeThread(thread.0) } == RESUME_FAILED {
                return Err(io::Error::last_os_error());
            }
            resumed += 1;
        }
        // SAFETY: same snapshot and entry.
        more = unsafe { Thread32Next(snap.0, &mut entry) } != 0;
    }
    if resumed == 0 {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("no thread of process {pid} to resume")));
    }
    Ok(())
}

fn wide_to_string(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

/// Every process whose program file name is `name` (without case), as process ids. An error means
/// the list could not be read: the caller must not take it for "none".
pub fn processes_named(name: &str) -> io::Result<Vec<u32>> {
    // SAFETY: snapshot of every process; handle owned below.
    let snap = Owned::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
    let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    let wanted = name.to_lowercase();
    let mut out = Vec::new();
    // SAFETY: `entry.dwSize` is set as the API requires.
    let mut more = unsafe { Process32FirstW(snap.0, &mut entry) } != 0;
    if !more {
        return Err(io::Error::last_os_error());
    }
    while more {
        if wide_to_string(&entry.szExeFile).to_lowercase() == wanted {
            out.push(entry.th32ProcessID);
        }
        // SAFETY: same snapshot and entry.
        more = unsafe { Process32NextW(snap.0, &mut entry) } != 0;
    }
    Ok(out)
}

/// Whether process `pid` still exists.
pub fn process_alive(pid: u32) -> bool {
    // SAFETY: plain open; a gone process cannot be opened.
    match Owned::new(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) }) {
        // SAFETY: valid handle; zero wait only polls.
        Ok(h) => (unsafe { WaitForSingleObject(h.0, 0) }) != WAIT_OBJECT_0,
        Err(_) => false,
    }
}

/// Kills process `pid` and waits up to `wait_ms` for it to be gone. `Ok(false)`: still there.
pub fn kill_pid(pid: u32, exit_code: u32, wait_ms: u32) -> io::Result<bool> {
    // SAFETY: plain open with the rights the calls below need.
    let h = Owned::new(unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, pid) })?;
    // SAFETY: valid handle.
    check(unsafe { TerminateProcess(h.0, exit_code) })?;
    // SAFETY: valid handle.
    Ok(unsafe { WaitForSingleObject(h.0, wait_ms) } == WAIT_OBJECT_0)
}

/// Full path of the program of process `pid`, lower case, or "" when it cannot be read.
pub fn image_name(pid: u32, max_chars: usize) -> String {
    // SAFETY: plain open with the least right the query needs.
    let Ok(h) = Owned::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) }) else { return String::new() };
    let mut buf = vec![0u16; max_chars];
    let mut size = max_chars as u32;
    // SAFETY: `buf` holds `size` characters.
    if unsafe { QueryFullProcessImageNameW(h.0, 0, buf.as_mut_ptr(), &mut size) } == 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..size as usize]).to_lowercase()
}

/// A visible top-level window: its handle (as a number, to cross threads), owner process, title.
pub struct Window {
    pub hwnd: isize,
    pub pid: u32,
    pub title: String,
}

unsafe extern "system" fn collect(hwnd: HWND, out: LPARAM) -> i32 {
    // SAFETY: `out` is the `Vec<Window>` passed by `visible_windows` for this enumeration only.
    let list = unsafe { &mut *(out as *mut Vec<Window>) };
    // SAFETY: `hwnd` comes from the enumeration.
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }
    let mut pid = 0u32;
    // SAFETY: `pid` is writable.
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    let mut title = [0u16; TITLE_CHARS];
    // SAFETY: `title` holds TITLE_CHARS characters.
    let n = unsafe { GetWindowTextW(hwnd, title.as_mut_ptr(), TITLE_CHARS as i32) }.max(0) as usize;
    list.push(Window { hwnd: hwnd as isize, pid, title: String::from_utf16_lossy(&title[..n]) });
    1
}

/// Every visible top-level window.
pub fn visible_windows() -> io::Result<Vec<Window>> {
    let mut list: Vec<Window> = Vec::new();
    // SAFETY: the callback only touches `list`, alive through the call.
    check(unsafe { EnumWindows(Some(collect), (&raw mut list) as LPARAM) })?;
    Ok(list)
}

/// Puts a window at the bottom of the Z-order, without moving, resizing or activating it.
pub fn send_to_back(hwnd: isize) -> io::Result<()> {
    // SAFETY: a stale handle only makes the call fail.
    check(unsafe { SetWindowPos(hwnd as HWND, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) })
}
