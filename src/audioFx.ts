// Web Audio API Synthesizer for High-Frequency DEX & Perps Audio FX
// Zero external assets, 100% client-side, zero latency

import { triggerHaptic } from './telegram';

let audioCtx: AudioContext | null = null;
let isAudioMuted = false;

// Initialize audio context on first user gesture
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export const getSoundMuted = (): boolean => {
  if (typeof window === 'undefined') return true;
  // Default to muted for a professional, clean FinTech experience
  return localStorage.getItem('volt_audio_muted') !== 'false';
};

export const setSoundMuted = (muted: boolean) => {
  isAudioMuted = muted;
  if (typeof window !== 'undefined') {
    localStorage.setItem('volt_audio_muted', muted ? 'true' : 'false');
  }
};

// 1. Subtle UI mechanical click (leverage slider, tab switches)
export const playClickSound = () => {
  triggerHaptic('light');
  if (getSoundMuted()) return;
  
  // Asynchronous non-blocking dispatch to prevent touch stutter on mobile devices
  setTimeout(() => {
    try {
      const ctx = getAudioContext();
      if (!ctx || ctx.state === 'suspended') return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.03);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.03);
    } catch (_) {}
  }, 0);
};

// 2. Order Submitted / Execution whoosh chime
export const playOrderSubmittedSound = () => {
  triggerHaptic('medium');
  if (getSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now); // A4
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  } catch (_) {}
};

// 3. Rewarding "Cha-Ching!" Harmonic Cash Sound (Closing in profit / Harvest)
export const playCashProfitSound = () => {
  triggerHaptic('success');
  if (getSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    // Dual bell chime chords: E6 (1318.5Hz) & G#6 (1661.2Hz)
    const freqs = [1318.5, 1661.2, 1975.5];

    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0.15, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.35);
    });
  } catch (_) {}
};

// 4. Alert / Warning Sound
export const playAlertSound = () => {
  triggerHaptic('warning');
  if (getSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.setValueAtTime(260, now + 0.08);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  } catch (_) {}
};
