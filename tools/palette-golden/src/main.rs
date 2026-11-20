#![allow(dead_code)]
mod features {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum Feature { Stt, Tts }
}
mod util {
    #[allow(clippy::cast_precision_loss)]
    pub fn usize_to_f32(value: usize) -> f32 { value as f32 }
    #[allow(clippy::cast_possible_truncation)]
    pub fn f64_to_f32(value: f64) -> f32 { value as f32 }
}
#[path = "palette.rs"]
mod palette;

use cosmic::iced::Color;
use features::Feature;
use palette::ColorPalette;

fn stops(g: palette::Gradient) -> Vec<[f32; 3]> {
    g.stops.iter().map(|c| [c.r, c.g, c.b]).collect()
}

fn main() {
    // Accents: GNOME's default blue, its other named accents, and a gray.
    let accents: Vec<(&str, Color)> = vec![
        ("blue", Color::from_rgb8(0x35, 0x84, 0xe4)),
        ("teal", Color::from_rgb8(0x21, 0x90, 0xa4)),
        ("green", Color::from_rgb8(0x3a, 0x94, 0x4a)),
        ("yellow", Color::from_rgb8(0xc8, 0x88, 0x00)),
        ("orange", Color::from_rgb8(0xed, 0x5b, 0x00)),
        ("red", Color::from_rgb8(0xe6, 0x2d, 0x42)),
        ("pink", Color::from_rgb8(0xd5, 0x61, 0x99)),
        ("purple", Color::from_rgb8(0x91, 0x41, 0xac)),
        ("slate", Color::from_rgb8(0x6f, 0x83, 0x96)),
        ("gray", Color::from_rgb8(0x80, 0x80, 0x80)),
    ];
    let mut out = serde_json::Map::new();
    for p in ColorPalette::ALL {
        let name = serde_json::to_value(p).unwrap().as_str().unwrap().to_string();
        let mut entry = serde_json::Map::new();
        entry.insert("label".into(), p.pretty_name().into());
        for (feature, fname) in [(Feature::Stt, "stt"), (Feature::Tts, "tts")] {
            for (dark, pname) in [(true, "dark"), (false, "light")] {
                if matches!(p, ColorPalette::Accent) {
                    let mut by_accent = serde_json::Map::new();
                    for (aname, accent) in &accents {
                        let accent_rgb = [accent.r, accent.g, accent.b];
                        by_accent.insert(
                            (*aname).into(),
                            serde_json::json!({"accent": accent_rgb, "stops": stops(p.gradient(feature, dark, *accent))}),
                        );
                    }
                    entry.insert(format!("{fname}.{pname}"), by_accent.into());
                } else {
                    entry.insert(
                        format!("{fname}.{pname}"),
                        serde_json::json!(stops(p.gradient(feature, dark, Color::BLACK))),
                    );
                }
            }
        }
        out.insert(name, entry.into());
    }
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
