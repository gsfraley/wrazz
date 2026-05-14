// Prevents a console window from opening on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wrazz_desktop_lib::run();
}
