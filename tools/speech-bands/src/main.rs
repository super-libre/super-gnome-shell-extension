//! Usage: speech-bands <mono f32le PCM file> <sample rate>
//!
//! Prints the frames the daemon would publish for the recording, as JSON:
//! `{sample_rate, window, frame_ms, speech_dbfs, frames: [{bands_b64,
//! total_energy}]}`.
//!
//! The recording's speech is first brought to [`SPEECH_DBFS`]: a recording
//! made for listening is mastered far louder than a voice reaches a
//! microphone, and the analyzer's bands grow with the square root of the
//! level, so a mastered file fills every bar.
use std::io::Read;

use base64::Engine;
use super_engine_protocol::audio::analysis::AudioAnalyzer;

/// The window the daemon analyzes, for dictation and for speech alike.
const WINDOW: usize = 1024;

/// The level the speech is brought to: ITU-T P.56's nominal active speech
/// level, -26 dB below full scale.
const SPEECH_DBFS: f64 = -26.0;

/// Windows quieter than this are pauses, left out of the speech's level.
const GATE_DBFS: f64 = -50.0;

fn dbfs(rms: f64) -> f64 {
    20.0 * rms.max(1e-12).log10()
}

fn rms(window: &[f32]) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let n = window.len() as f64;
    (window.iter().map(|&s| f64::from(s) * f64::from(s)).sum::<f64>() / n).sqrt()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, path, rate] = args.as_slice() else {
        eprintln!("usage: speech-bands <mono f32le PCM file> <sample rate>");
        std::process::exit(2);
    };
    let rate: u32 = rate.parse().expect("a sample rate");
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|mut f| f.read_to_end(&mut bytes))
        .expect("the recording");
    let mut samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    // The speech's level: the power of the windows above the gate.
    let speech: Vec<f64> = samples
        .chunks_exact(WINDOW)
        .map(rms)
        .filter(|&r| dbfs(r) > GATE_DBFS)
        .collect();
    #[allow(clippy::cast_precision_loss)]
    let level = (speech.iter().map(|r| r * r).sum::<f64>() / speech.len().max(1) as f64).sqrt();
    #[allow(clippy::cast_possible_truncation)]
    let gain = 10f64.powf((SPEECH_DBFS - dbfs(level)) / 20.0) as f32;
    eprintln!(
        "speech at {:.1} dBFS, brought to {SPEECH_DBFS} dBFS (gain {gain:.3})",
        dbfs(level)
    );
    for sample in &mut samples {
        *sample = (*sample * gain).clamp(-1.0, 1.0);
    }

    let analyzer = AudioAnalyzer::new(rate, WINDOW);
    let frames: Vec<serde_json::Value> = samples
        .chunks_exact(WINDOW)
        .map(|window| {
            let data = analyzer.analyze(window);
            let raw: Vec<u8> = data.bands.iter().flat_map(|b| b.to_le_bytes()).collect();
            serde_json::json!({
                "bands_b64": base64::engine::general_purpose::STANDARD.encode(raw),
                "total_energy": data.total_energy,
            })
        })
        .collect();
    #[allow(clippy::cast_precision_loss)]
    let frame_ms = WINDOW as f64 * 1000.0 / f64::from(rate);
    let out = serde_json::json!({
        "sample_rate": rate,
        "window": WINDOW,
        "frame_ms": frame_ms,
        "speech_dbfs": SPEECH_DBFS,
        "frames": frames,
    });
    println!("{out}");
}
