import { SettingsProvider } from "./settings/store";
import AppShell from "./shell/AppShell";

export default function App() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}
