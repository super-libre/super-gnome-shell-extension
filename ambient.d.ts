// SPDX-License-Identifier: GPL-3.0-only
// The types GNOME Shell and GJS provide at runtime. Nothing here is emitted:
// the extension imports `gi://…` and `resource:///…` modules, and these
// packages declare them.
import '@girs/gjs';
import '@girs/gjs/dom';
import '@girs/gnome-shell/ambient';
import '@girs/gnome-shell/extensions/global';
import '@girs/soup-3.0';
