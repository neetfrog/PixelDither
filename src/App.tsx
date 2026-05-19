import { useState, useRef, useEffect, useCallback } from 'react';
import { applyDither, DitherAlgorithm, ProcessOptions, GlitchOptions } from './dither';
import { PALETTES, Palette } from './palettes';
import { PRESETS } from './presets';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GLITCH: GlitchOptions = {
  rgbShift: 0,
  scanlines: false,
  pixelScatter: 0,
  interlace: false,
  vhsBlur: 0,
};

const DEFAULT_OPTS: ProcessOptions = {
  palette: PALETTES[0].colors,
  algorithm: 'floyd_steinberg',
  pixelSize: 4,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  localContrast: 0,
  ditherStrength: 0.8,
  aspectRatio: '1:1',
  glitch: DEFAULT_GLITCH,
};

const ALGORITHMS: { id: DitherAlgorithm; label: string; category: string }[] = [
  { id: 'none',            label: 'None (Quantize)',     category: 'Basic' },
  { id: 'floyd_steinberg', label: 'Floyd-Steinberg',     category: 'Error Diffusion' },
  { id: 'atkinson',        label: 'Atkinson',            category: 'Error Diffusion' },
  { id: 'jarvis',          label: 'Jarvis-Judice-Ninke', category: 'Error Diffusion' },
  { id: 'stucki',          label: 'Stucki',              category: 'Error Diffusion' },
  { id: 'sierra',          label: 'Sierra',              category: 'Error Diffusion' },
  { id: 'sierra_lite',     label: 'Sierra Lite',         category: 'Error Diffusion' },
  { id: 'bayer2',          label: 'Bayer 2×2',           category: 'Ordered' },
  { id: 'bayer4',          label: 'Bayer 4×4',           category: 'Ordered' },
  { id: 'bayer8',          label: 'Bayer 8×8',           category: 'Ordered' },
  { id: 'bayer16',         label: 'Bayer 16×16',         category: 'Ordered' },
  { id: 'checkerboard',    label: 'Checkerboard',        category: 'Pattern' },
  { id: 'pattern2x2',      label: 'Pattern 2×2',         category: 'Pattern' },
  { id: 'blue_noise',      label: 'Blue Noise',          category: 'Noise' },
  { id: 'noise',           label: 'Random Noise',        category: 'Noise' },
];

type ViewMode = 'output' | 'original';
type TabId = 'presets' | 'palette' | 'dither' | 'adjust' | 'glitch';

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState<TabId>('presets');
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [opts, setOpts] = useState<ProcessOptions>(DEFAULT_OPTS);
  const [selectedPaletteId, setSelectedPaletteId] = useState<string>(PALETTES[0].id);
  const [customColors, setCustomColors] = useState<string[]>(['#000000', '#555555', '#aaaaaa', '#ffffff']);
  const [useCustomPalette, setUseCustomPalette] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string>('');
  const [originalUrl, setOriginalUrl] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const [paletteFilter, setPaletteFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('output');
  const [gridOverlay, setGridOverlay] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load image onto hidden canvas ──────────────────────────────────
  useEffect(() => {
    if (!imageEl || !srcCanvasRef.current) return;
    const canvas = srcCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const maxDim = 1400;
    let w = imageEl.naturalWidth;
    let h = imageEl.naturalHeight;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(imageEl, 0, 0, w, h);
    // Capture original for comparison
    setOriginalUrl(canvas.toDataURL('image/jpeg', 0.85));
    triggerProcess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageEl]);

  // ── Auto-reprocess when opts change ───────────────────────────────
  useEffect(() => {
    if (!imageEl) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => triggerProcess(), 100);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, imageEl]);

  const triggerProcess = useCallback(() => {
    if (!srcCanvasRef.current || !imageEl) return;
    setProcessing(true);
    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          const result = applyDither(srcCanvasRef.current!, opts);
          setOutputUrl(result.toDataURL('image/png'));
        } catch (e) {
          console.error('Dither error:', e);
        }
        setProcessing(false);
      }, 10);
    });
  }, [imageEl, opts]);

  // ── Camera setup and cleanup ───────────────────────────────────────
  useEffect(() => {
    if (!cameraActive) {
      // Clean up camera stream
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      return;
    }

    // Request camera access
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCameraError(null);
        }
      })
      .catch(err => {
        setCameraError(`Camera access denied: ${err.message}`);
        setCameraActive(false);
      });

    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraActive]);

  // ── Helpers ────────────────────────────────────────────────────────
  const setPalette = (p: Palette) => {
    setSelectedPaletteId(p.id);
    setUseCustomPalette(false);
    setOpts(o => ({ ...o, palette: p.colors }));
  };

  const applyCustomPalette = () => {
    setUseCustomPalette(true);
    setSelectedPaletteId('custom');
    setOpts(o => ({ ...o, palette: customColors }));
  };

  const loadImageFromFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImageEl(img);
    img.src = url;
  };

  const captureFromCamera = () => {
    if (!videoRef.current || !cameraCanvasRef.current) return;
    const canvas = cameraCanvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    // Set canvas size to video size
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    
    // Draw video frame to canvas
    ctx.drawImage(videoRef.current, 0, 0);
    
    // Create image from canvas
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        setImageEl(img);
        setCameraActive(false);
      };
      img.src = url;
    }, 'image/jpeg', 0.95);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadImageFromFile(file);
  };

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    const pal = PALETTES.find(p => p.id === preset.paletteId);
    if (!pal) return;
    setSelectedPaletteId(pal.id);
    setUseCustomPalette(false);
    setActivePreset(presetId);
    setOpts({
      ...DEFAULT_OPTS,
      ...preset.opts,
      palette: pal.colors,
      glitch: preset.opts.glitch ?? DEFAULT_GLITCH,
    });
  };

  const downloadOutput = () => {
    if (!outputUrl) return;
    const a = document.createElement('a');
    a.href = outputUrl;
    a.download = `pixeldither_${activePreset || 'custom'}.png`;
    a.click();
  };

  const setOpt = <K extends keyof ProcessOptions>(key: K, val: ProcessOptions[K]) =>
    setOpts(o => ({ ...o, [key]: val }));

  const setGlitch = <K extends keyof GlitchOptions>(key: K, val: GlitchOptions[K]) =>
    setOpts(o => ({ ...o, glitch: { ...o.glitch, [key]: val } }));

  const currentPaletteName = useCustomPalette
    ? 'Custom'
    : PALETTES.find(p => p.id === selectedPaletteId)?.name ?? '';

  const filteredPalettes = PALETTES.filter(
    p =>
      p.name.toLowerCase().includes(paletteFilter.toLowerCase()) ||
      p.system.toLowerCase().includes(paletteFilter.toLowerCase())
  );

  const hasGlitch =
    opts.glitch.rgbShift > 0 ||
    opts.glitch.vhsBlur > 0 ||
    opts.glitch.pixelScatter > 0 ||
    opts.glitch.scanlines ||
    opts.glitch.interlace;

  // ── Tab icons ──────────────────────────────────────────────────────
  const TABS: { id: TabId; icon: string; label: string }[] = [
    { id: 'presets', icon: '⭐', label: 'Presets' },
    { id: 'palette', icon: '🎨', label: 'Palette' },
    { id: 'dither',  icon: '◼',  label: 'Dither' },
    { id: 'adjust',  icon: '🎛',  label: 'Adjust' },
    { id: 'glitch',  icon: '💥', label: 'Glitch' },
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100 overflow-hidden select-none">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 py-2 bg-gray-900 border-b border-gray-800 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(s => !s)}
            className="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none px-1"
            title="Toggle sidebar"
          >
            ☰
          </button>
          <div className="flex items-baseline gap-1">
            <span className="text-green-400 font-bold text-xl tracking-widest font-mono">PIXEL</span>
            <span className="text-purple-400 font-bold text-xl tracking-widest font-mono">DITHER</span>
          </div>
          <span className="text-gray-700 text-xs font-mono hidden sm:block">// 8-bit photo lab</span>
        </div>

        <div className="flex items-center gap-2">
          {imageEl && (
            <>
              {/* View mode toggle */}
              <div className="flex bg-gray-800 rounded overflow-hidden border border-gray-700">
                {(['output','original'] as ViewMode[]).map(vm => (
                  <button
                    key={vm}
                    onClick={() => setViewMode(vm)}
                    className={`px-2 py-1 text-xs transition-colors ${viewMode === vm ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    {vm === 'output' ? '🖼' : '📷'}
                  </button>
                ))}
              </div>
              {/* Grid toggle */}
              <button
                onClick={() => setGridOverlay(g => !g)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${gridOverlay ? 'border-green-600 text-green-400 bg-green-950' : 'border-gray-700 text-gray-500 hover:text-gray-300'}`}
                title="Toggle pixel grid"
              >
                ⊞
              </button>
              <button
                onClick={downloadOutput}
                disabled={!outputUrl || processing}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded text-xs font-bold transition-colors font-mono"
              >
                ⬇ SAVE
              </button>
            </>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 rounded text-xs font-bold transition-colors font-mono"
          >
            📁 IMPORT
          </button>
          <button
            onClick={() => setCameraActive(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs font-bold transition-colors font-mono"
            title="Capture from webcam"
          >
            📷 CAMERA
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) loadImageFromFile(f);
              e.target.value = '';
            }}
          />
          <canvas ref={cameraCanvasRef} className="hidden" />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <aside className="w-56 sm:w-72 bg-gray-900 border-r border-gray-800 flex flex-col overflow-hidden shrink-0">
            {/* Tab bar */}
            <div className="flex border-b border-gray-800 shrink-0">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={t.label}
                  className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
                    tab === t.id
                      ? 'bg-gray-800 text-green-400 border-b-2 border-green-400'
                      : 'text-gray-600 hover:text-gray-300'
                  }`}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  <span className="text-[9px] uppercase tracking-widest">{t.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">

              {/* ── PRESETS ───────────────────────────────────────── */}
              {tab === 'presets' && (
                <div className="space-y-2">
                  <SectionHeader>Console Presets</SectionHeader>
                  {PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset.id)}
                      className={`w-full text-left px-3 py-2.5 rounded transition-colors group ${
                        activePreset === preset.id
                          ? 'bg-green-900 border border-green-700'
                          : 'bg-gray-800 hover:bg-gray-750 border border-transparent hover:border-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl leading-none">{preset.emoji}</span>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-gray-200 group-hover:text-white font-mono truncate">
                            {preset.name}
                          </div>
                          <div className="text-xs text-gray-500 truncate">{preset.description}</div>
                        </div>
                        {activePreset === preset.id && (
                          <span className="ml-auto text-green-400 text-xs shrink-0">▶</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* ── PALETTE ───────────────────────────────────────── */}
              {tab === 'palette' && (
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="🔍 Search palettes…"
                    value={paletteFilter}
                    onChange={e => setPaletteFilter(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-green-500 font-mono"
                  />

                  <div className="space-y-1">
                    {filteredPalettes.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setPalette(p)}
                        className={`w-full text-left px-2 py-2 rounded transition-colors ${
                          selectedPaletteId === p.id && !useCustomPalette
                            ? 'bg-green-900 border border-green-700'
                            : 'bg-gray-800 hover:bg-gray-750 border border-transparent hover:border-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-sm">{p.emoji}</span>
                          <span className="text-xs font-bold text-gray-200 font-mono">{p.name}</span>
                          <span className="ml-auto text-xs text-gray-600">{p.colors.length}c</span>
                        </div>
                        <div className="flex gap-0.5 flex-wrap">
                          {p.colors.slice(0, 32).map((c, i) => (
                            <div
                              key={i}
                              className="w-3 h-3 rounded-sm border border-black/20"
                              style={{ backgroundColor: c }}
                              title={c}
                            />
                          ))}
                          {p.colors.length > 32 && (
                            <div className="w-3 h-3 rounded-sm bg-gray-700 flex items-center justify-center">
                              <span className="text-[6px] text-gray-400">+{p.colors.length-32}</span>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Custom palette builder */}
                  <div className={`p-3 rounded border ${useCustomPalette ? 'border-green-700 bg-green-950/50' : 'border-gray-700 bg-gray-800'}`}>
                    <SectionHeader>Custom Palette</SectionHeader>
                    <div className="flex flex-wrap gap-1 mb-2 mt-2">
                      {customColors.map((c, i) => (
                        <label key={i} className="relative cursor-pointer group">
                          <div
                            className="w-7 h-7 rounded border-2 border-gray-600 group-hover:border-gray-400 transition-colors"
                            style={{ backgroundColor: c }}
                          />
                          <input
                            type="color"
                            value={c}
                            onChange={e => {
                              const nc = [...customColors];
                              nc[i] = e.target.value;
                              setCustomColors(nc);
                              if (useCustomPalette) setOpts(o => ({ ...o, palette: nc }));
                            }}
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          />
                          <button
                            onClick={ev => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              const nc = customColors.filter((_, j) => j !== i);
                              setCustomColors(nc);
                              if (useCustomPalette && nc.length > 0) setOpts(o => ({ ...o, palette: nc }));
                            }}
                            className="absolute -top-1 -right-1 w-3 h-3 bg-red-700 rounded-full text-white text-[8px] hidden group-hover:flex items-center justify-center z-10"
                          >×</button>
                        </label>
                      ))}
                      <button
                        onClick={() => {
                          const nc = [...customColors, '#808080'];
                          setCustomColors(nc);
                          if (useCustomPalette) setOpts(o => ({ ...o, palette: nc }));
                        }}
                        className="w-7 h-7 rounded border-2 border-dashed border-gray-600 text-gray-500 hover:text-white hover:border-gray-400 text-lg flex items-center justify-center transition-colors"
                      >+</button>
                    </div>
                    <button
                      onClick={applyCustomPalette}
                      className="w-full py-1.5 text-xs bg-green-700 hover:bg-green-600 rounded transition-colors font-mono font-bold"
                    >
                      USE CUSTOM PALETTE
                    </button>
                  </div>
                </div>
              )}

              {/* ── DITHER ────────────────────────────────────────── */}
              {tab === 'dither' && (
                <div className="space-y-5">
                  <div>
                    <SliderRow
                      label="Pixel Block Size"
                      value={opts.pixelSize}
                      min={1} max={32}
                      onChange={v => setOpt('pixelSize', v)}
                      format={v => `${v}px`}
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Pixel Aspect Ratio</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['1:1', '2:1', '1:2'] as const).map(ar => (
                        <button
                          key={ar}
                          onClick={() => setOpt('aspectRatio', ar)}
                          className={`py-1.5 text-xs rounded font-mono transition-colors border ${
                            opts.aspectRatio === ar
                              ? 'bg-green-800 text-green-200 border-green-600'
                              : 'bg-gray-800 text-gray-400 hover:text-white border-gray-700'
                          }`}
                        >
                          {ar}
                          <div className="text-[9px] text-gray-500">
                            {ar === '1:1' ? 'square' : ar === '2:1' ? 'wide' : 'tall'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-widest block mb-2">Dither Algorithm</label>
                    {['Basic', 'Error Diffusion', 'Ordered', 'Pattern', 'Noise'].map(cat => (
                      <div key={cat} className="mb-3">
                        <p className="text-xs text-gray-700 mb-1 font-mono">{cat}</p>
                        <div className="space-y-0.5">
                          {ALGORITHMS.filter(a => a.category === cat).map(a => (
                            <button
                              key={a.id}
                              onClick={() => setOpt('algorithm', a.id)}
                              className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition-colors ${
                                opts.algorithm === a.id
                                  ? 'bg-purple-900 text-purple-200 border border-purple-700'
                                  : 'text-gray-500 hover:bg-gray-800 hover:text-gray-200'
                              }`}
                            >
                              {opts.algorithm === a.id ? '▶ ' : '  '}{a.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <SliderRow
                    label="Dither Strength"
                    value={opts.ditherStrength}
                    min={0} max={1} step={0.05}
                    onChange={v => setOpt('ditherStrength', v)}
                    format={v => `${Math.round(v * 100)}%`}
                  />
                </div>
              )}

              {/* ── ADJUST ────────────────────────────────────────── */}
              {tab === 'adjust' && (
                <div className="space-y-5">
                  <SectionHeader>Color Adjustments</SectionHeader>
                  <SliderRow label="Brightness" value={opts.brightness} min={-100} max={100}
                    onChange={v => setOpt('brightness', v)} format={v => (v >= 0 ? `+${v}` : `${v}`)} />
                  <SliderRow label="Contrast" value={opts.contrast} min={-100} max={100}
                    onChange={v => setOpt('contrast', v)} format={v => (v >= 0 ? `+${v}` : `${v}`)} />
                  <SliderRow label="Saturation" value={opts.saturation} min={-100} max={100}
                    onChange={v => setOpt('saturation', v)} format={v => (v >= 0 ? `+${v}` : `${v}`)} />
                  <div>
                    <SliderRow label="Local Contrast" value={opts.localContrast} min={-100} max={100}
                      onChange={v => setOpt('localContrast', v)} format={v => (v >= 0 ? `+${v}` : `${v}`)} />
                    <p className="text-xs text-gray-600 mt-1">Unsharp mask — brings out edge detail</p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setOpts(o => ({ ...o, brightness: 0, contrast: 0, saturation: 0, localContrast: 0 }))}
                      className="flex-1 py-1.5 text-xs text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600 rounded transition-colors font-mono"
                    >
                      RESET
                    </button>
                  </div>

                  <div className="border-t border-gray-800 pt-4">
                    <SectionHeader>Presets</SectionHeader>
                    <div className="grid grid-cols-2 gap-1 mt-2">
                      {[
                        { label: 'Boost Contrast', b: 10, c: 40, s: 0, lc: 20 },
                        { label: 'Vivid',           b: 5,  c: 20, s: 60, lc: 10 },
                        { label: 'Faded',           b: -5, c:-30, s:-30, lc: 0 },
                        { label: 'Hard B&W',        b: 0,  c: 50, s:-100, lc: 40 },
                        { label: 'Soft Focus',      b: 10, c:-20, s: 0,  lc:-40 },
                        { label: 'HDR-ish',         b: 0,  c: 30, s: 40, lc: 60 },
                      ].map(p => (
                        <button
                          key={p.label}
                          onClick={() => setOpts(o => ({ ...o, brightness: p.b, contrast: p.c, saturation: p.s, localContrast: p.lc }))}
                          className="py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors font-mono"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* ── GLITCH ────────────────────────────────────────── */}
              {tab === 'glitch' && (
                <div className="space-y-5">
                  <SectionHeader>Glitch & Screen Effects</SectionHeader>
                  <p className="text-xs text-gray-600">Add digital artefacts and screen simulation</p>

                  <SliderRow label="RGB Shift" value={opts.glitch.rgbShift} min={0} max={20}
                    onChange={v => setGlitch('rgbShift', v)} format={v => `${v}px`} />

                  <SliderRow label="VHS Blur" value={opts.glitch.vhsBlur} min={0} max={10} step={1}
                    onChange={v => setGlitch('vhsBlur', v)} format={v => `${v}`} />

                  <SliderRow label="Pixel Scatter" value={opts.glitch.pixelScatter} min={0} max={10} step={1}
                    onChange={v => setGlitch('pixelScatter', v)} format={v => `${v}`} />

                  <div className="space-y-3">
                    <ToggleRow label="Scanlines" value={opts.glitch.scanlines}
                      onChange={v => setGlitch('scanlines', v)} />
                    <ToggleRow label="Interlace" value={opts.glitch.interlace}
                      onChange={v => setGlitch('interlace', v)} />
                  </div>

                  <div className="border-t border-gray-800 pt-3">
                    <p className="text-xs text-gray-500 mb-2 font-mono">QUICK GLITCH PRESETS</p>
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { label: 'CRT TV',    g: { rgbShift: 2, scanlines: true, pixelScatter: 0, interlace: true, vhsBlur: 0 } },
                        { label: 'VHS Tape',  g: { rgbShift: 4, scanlines: true, pixelScatter: 1, interlace: false, vhsBlur: 6 } },
                        { label: 'Glitched',  g: { rgbShift: 12, scanlines: false, pixelScatter: 8, interlace: true, vhsBlur: 2 } },
                        { label: 'RGB Ghost', g: { rgbShift: 8, scanlines: false, pixelScatter: 0, interlace: false, vhsBlur: 3 } },
                        { label: 'None',      g: DEFAULT_GLITCH },
                      ].map(p => (
                        <button
                          key={p.label}
                          onClick={() => setOpts(o => ({ ...o, glitch: p.g }))}
                          className="py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors font-mono"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {hasGlitch && (
                    <button
                      onClick={() => setOpts(o => ({ ...o, glitch: DEFAULT_GLITCH }))}
                      className="w-full py-1.5 text-xs text-gray-500 hover:text-gray-300 border border-gray-700 hover:border-gray-600 rounded transition-colors font-mono"
                    >
                      RESET GLITCH
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Bottom palette strip ───────────────────────────── */}
            <div className="p-2 border-t border-gray-800 shrink-0 bg-gray-900">
              <div className="flex gap-0.5 flex-wrap mb-1">
                {opts.palette.slice(0, 48).map((c, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 border border-black/30"
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600 font-mono truncate">
                  {currentPaletteName} · {opts.palette.length}c
                </p>
                <p className="text-xs text-gray-700 font-mono">
                  {opts.pixelSize}px · {ALGORITHMS.find(a => a.id === opts.algorithm)?.label.split('-')[0]}
                </p>
              </div>
            </div>
          </aside>
        )}

        {/* ── Main Canvas Area ─────────────────────────────────────── */}
        <main className="flex-1 flex flex-col items-center justify-center overflow-auto bg-gray-950 relative">

          {/* Hidden source canvas */}
          <canvas ref={srcCanvasRef} className="hidden" />

          {!imageEl ? (
            /* ── Drop Zone ────────────────────────────────────────── */
            <div className="flex flex-col items-center justify-center w-full h-full p-4 sm:p-8">
              <div
                className={`w-full max-w-2xl rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all p-6 sm:p-12 ${
                  dragOver
                    ? 'border-green-400 bg-green-950/30 scale-105'
                    : 'border-gray-700 hover:border-gray-500 bg-gray-900/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <div className="text-6xl sm:text-7xl mb-4 sm:mb-5 select-none">🖼️</div>
                <p className="text-gray-300 text-xl sm:text-2xl font-bold font-mono mb-3">DROP IMAGE HERE</p>
                <p className="text-gray-600 text-xs sm:text-sm font-mono text-center leading-relaxed">or click to browse<br className="sm:hidden" />· PNG · JPG · WebP · GIF</p>

                <div className="mt-10 w-full max-w-lg">
                  <p className="text-xs text-gray-700 font-mono uppercase tracking-widest mb-3 text-center">AVAILABLE PRESETS</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {PRESETS.slice(0, 8).map(p => (
                      <div key={p.id} className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-800 rounded text-center">
                        <span className="text-2xl">{p.emoji}</span>
                        <span className="text-xs text-gray-500 font-mono">{p.name}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-700 text-center mt-3 font-mono">…and {PRESETS.length - 8} more presets, {PALETTES.length} palettes, 15 dither algorithms</p>
                </div>
              </div>
            </div>
          ) : (
            /* ── Image Output ─────────────────────────────────────── */
            <div className="flex flex-col items-center gap-4 w-full h-full p-4">
              {/* Processing spinner */}
              {processing && (
                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                  <div className="flex items-center gap-3 bg-gray-900/90 border border-gray-700 px-5 py-3 rounded-xl shadow-2xl">
                    <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-green-400 font-mono">PROCESSING…</span>
                  </div>
                </div>
              )}

              {/* Canvas display */}
              <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
                {viewMode === 'output' && outputUrl && (
                  <div className="relative">
                    <img
                      src={outputUrl}
                      alt="Dithered output"
                      className="max-w-full max-h-full rounded shadow-2xl"
                      style={{
                        imageRendering: 'pixelated',
                        maxHeight: 'calc(100vh - 160px)',
                      }}
                    />
                    {gridOverlay && (
                      <GridOverlay pixelSize={opts.pixelSize} />
                    )}
                  </div>
                )}

                {viewMode === 'original' && originalUrl && (
                  <img
                    src={originalUrl}
                    alt="Original"
                    className="max-w-full max-h-full rounded shadow-2xl"
                    style={{ maxHeight: 'calc(100vh - 160px)' }}
                  />
                )}
              </div>

              {/* Info / action bar */}
              <div className="shrink-0 flex items-center justify-between w-full max-w-3xl">
                <div className="flex items-center gap-3 text-xs text-gray-600 font-mono flex-wrap">
                  <span className="text-gray-500">{currentPaletteName}</span>
                  <span>·</span>
                  <span>{ALGORITHMS.find(a => a.id === opts.algorithm)?.label}</span>
                  <span>·</span>
                  <span>{opts.pixelSize}px blocks</span>
                  {hasGlitch && <><span>·</span><span className="text-purple-400">glitch</span></>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setImageEl(null); setOutputUrl(''); setOriginalUrl(''); setActivePreset(''); }}
                    className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-700 transition-colors font-mono"
                  >
                    🗑 Clear
                  </button>
                  <button
                    onClick={downloadOutput}
                    disabled={!outputUrl || processing}
                    className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-40 rounded transition-colors font-mono font-bold"
                  >
                    ⬇ SAVE
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── Camera Modal ─────────────────────────────────────────────── */}
      {cameraActive && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border-2 border-blue-600 rounded-lg shadow-2xl flex flex-col items-center gap-4 p-6 max-w-lg w-full">
            <h2 className="text-xl font-bold text-blue-400 font-mono">📷 CAMERA CAPTURE</h2>
            
            {cameraError ? (
              <div className="text-center text-red-400 text-sm">
                <p className="font-mono mb-2">{cameraError}</p>
                <button
                  onClick={() => {
                    setCameraError(null);
                    setCameraActive(false);
                  }}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-xs font-bold transition-colors font-mono"
                >
                  CLOSE
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full aspect-video bg-black rounded border border-gray-700"
                  style={{ maxWidth: '100%' }}
                />
                <div className="flex gap-3 w-full">
                  <button
                    onClick={captureFromCamera}
                    className="flex-1 px-4 py-3 bg-green-700 hover:bg-green-600 rounded text-xs font-bold transition-colors font-mono text-white"
                  >
                    📸 SNAP & DITHER
                  </button>
                  <button
                    onClick={() => setCameraActive(false)}
                    className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded text-xs font-bold transition-colors font-mono text-gray-100"
                  >
                    ✕ CANCEL
                  </button>
                </div>
                <p className="text-xs text-gray-500 text-center font-mono">
                  Position your subject and click SNAP<br />to capture and apply dithering effects
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-gray-500 uppercase tracking-widest font-mono">{children}</p>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}

function SliderRow({ label, value, min, max, step = 1, onChange, format }: SliderRowProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-xs text-gray-400 uppercase tracking-widest font-mono">{label}</label>
        <span className="text-xs text-green-400 tabular-nums font-mono font-bold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
      />
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, value, onChange }: ToggleRowProps) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center justify-between w-full group"
    >
      <span className="text-xs text-gray-400 uppercase tracking-widest font-mono group-hover:text-gray-300 transition-colors">{label}</span>
      <div className={`w-10 h-5 rounded-full relative transition-colors ${value ? 'bg-green-600' : 'bg-gray-700'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${value ? 'left-5' : 'left-0.5'}`} />
      </div>
    </button>
  );
}

function GridOverlay({ pixelSize }: { pixelSize: number }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)
        `,
        backgroundSize: `${pixelSize * 2}px ${pixelSize * 2}px`,
      }}
    />
  );
}
