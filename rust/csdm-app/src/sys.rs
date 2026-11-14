//! The two Windows facts the shell reads: local time (console timestamps) and the
//! "show animations" preference (3.5 followed `prefers-reduced-motion` live).

#[repr(C)]
#[derive(Default)]
struct SystemTime {
    year: u16,
    month: u16,
    day_of_week: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    millis: u16,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetLocalTime(st: *mut SystemTime);
}

#[link(name = "user32")]
extern "system" {
    fn SystemParametersInfoW(action: u32, param: u32, out: *mut core::ffi::c_void, win_ini: u32) -> i32;
}

/// `SPI_GETCLIENTAREAANIMATION`: Windows › Accessibility › "Show animations".
const SPI_GETCLIENTAREAANIMATION: u32 = 0x1042;

/// `HH:MM:SS`, local time.
pub fn local_hms() -> String {
    let mut st = SystemTime::default();
    // SAFETY: GetLocalTime only writes the struct it is given.
    unsafe { GetLocalTime(&mut st) };
    format!("{:02}:{:02}:{:02}", st.hour, st.minute, st.second)
}

/// True when Windows asks for reduced motion. Unknown (call failed) = animations allowed.
pub fn reduced_motion() -> bool {
    let mut on: i32 = 1;
    // SAFETY: the action writes one BOOL into the pointed-to i32.
    let ok = unsafe { SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, (&mut on as *mut i32).cast(), 0) };
    ok != 0 && on == 0
}
