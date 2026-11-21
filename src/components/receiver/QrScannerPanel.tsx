import jsQR from 'jsqr';
import { Camera, CameraOff, Link2, QrCode, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { parseQrJoinPayload, type ParsedQrPayload } from '../../utils/platform.ts';

interface QrScannerPanelProps {
  onDecoded: (payload: ParsedQrPayload) => void;
}

export function QrScannerPanel({ onDecoded }: QrScannerPanelProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [inviteText, setInviteText] = useState('');
  const [scanHint, setScanHint] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleDecodedRaw = useCallback(
    (rawText: string) => {
      const parsed = parseQrJoinPayload(rawText);
      if (!parsed || !parsed.code) {
        setScanError(
          'QR code was detected, but it does not contain a valid MultiCast room code.',
        );
        return false;
      }
      setScanError(null);
      setScanHint(`Decoded room ${parsed.code}. Enter the room PIN to connect.`);
      stopCamera();
      onDecoded(parsed);
      return true;
    },
    [onDecoded, stopCamera],
  );

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const BarcodeDetectorCtor = (
        window as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
          };
        }
      ).BarcodeDetector;

      if (BarcodeDetectorCtor) {
        try {
          const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
          const barcodes = await detector.detect(video);
          for (const barcode of barcodes) {
            if (barcode.rawValue && handleDecodedRaw(barcode.rawValue)) {
              return;
            }
          }
        } catch {
          // Fall through to jsQR canvas decoding
        }
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (result?.data && handleDecodedRaw(result.data)) {
          return;
        }
      }
    }

    if (streamRef.current) {
      rafRef.current = window.requestAnimationFrame(() => {
        void scanFrame();
      });
    }
  }, [handleDecodedRaw]);

  const startCamera = async () => {
    setScanError(null);
    setScanHint(null);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setScanError(
        'Camera access requires HTTPS or localhost. Use QR Image Upload or Paste Room Link below.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      // Attach stream on next tick once <video> mounts
      window.setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          void videoRef.current.play().catch(() => {});
          rafRef.current = window.requestAnimationFrame(() => {
            void scanFrame();
          });
        }
      }, 40);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Camera permission was denied or no webcam was found.';
      setScanError(`Unable to start QR camera scanner: ${message}`);
      stopCamera();
    }
  };

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setScanError(null);
    setScanHint(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setScanError('Could not initialize image decoder context.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (!decoded?.data) {
          setScanError('No readable QR code found in the selected image.');
          return;
        }
        handleDecodedRaw(decoded.data);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setScanError('Unable to read the selected image file.');
    };

    img.src = objectUrl;
  };

  const handleParseInviteInput = () => {
    setScanError(null);
    setScanHint(null);
    const parsed = parseQrJoinPayload(inviteText);
    if (!parsed || !parsed.code) {
      setScanError(
        'Enter a valid room link (e.g. https://.../join?code=K7P4M9) or 6-character room code.',
      );
      return;
    }
    setScanHint(`Filled room ${parsed.code}. Enter the room PIN to connect.`);
    onDecoded(parsed);
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 flex flex-col justify-between space-y-5 w-full">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600 shrink-0">
            <QrCode className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-display text-base font-semibold text-zinc-900">
              QR Code Joining
            </h3>
            <p className="text-xs text-zinc-500">
              Scan the source QR code with your camera, upload an image, or paste a room link.
            </p>
          </div>
        </div>

        {scanError ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 leading-relaxed"
          >
            {scanError}
          </div>
        ) : null}

        {scanHint ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800">
            {scanHint}
          </div>
        ) : null}

        {cameraActive ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-[#09090B] aspect-video w-full overflow-hidden relative">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
              >
                <div className="w-40 h-40 sm:w-44 sm:h-44 relative rounded-lg border border-white/25 bg-black/5">
                  <span className="absolute -top-0.5 -left-0.5 h-5 w-5 border-t-2 border-l-2 border-red-500 rounded-tl-sm" />
                  <span className="absolute -top-0.5 -right-0.5 h-5 w-5 border-t-2 border-r-2 border-red-500 rounded-tr-sm" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-5 w-5 border-b-2 border-l-2 border-red-500 rounded-bl-sm" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 border-b-2 border-r-2 border-red-500 rounded-br-sm" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <button
              type="button"
              onClick={stopCamera}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50 transition-colors touch-manipulation"
            >
              <CameraOff className="h-3.5 w-3.5" />
              <span>Stop Camera Scanner</span>
            </button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void startCamera()}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 bg-white hover:border-red-200 hover:bg-red-50/40 text-xs font-medium text-zinc-900 transition-colors whitespace-nowrap touch-manipulation"
            >
              <Camera className="h-4 w-4 text-red-600" />
              <span>Scan with Camera</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-zinc-200 bg-white hover:border-red-200 hover:bg-red-50/40 text-xs font-medium text-zinc-900 transition-colors whitespace-nowrap touch-manipulation"
            >
              <Upload className="h-4 w-4 text-red-600" />
              <span>Upload QR Image</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-zinc-200 space-y-2.5">
        <label
          htmlFor="qr-invite-paste"
          className="block text-xs font-medium text-zinc-700"
        >
          Paste Room Link or Room Code
        </label>
        <div className="flex gap-2">
          <input
            id="qr-invite-paste"
            type="text"
            value={inviteText}
            onChange={(e) => setInviteText(e.target.value)}
            placeholder="https://.../join?code=K7P4M9"
            className="flex-1 min-w-0 min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base sm:text-xs text-zinc-900 placeholder:text-zinc-400 font-mono focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
          />
          <button
            type="button"
            onClick={handleParseInviteInput}
            className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-xs font-medium text-zinc-900 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
          >
            <Link2 className="h-3.5 w-3.5 text-red-600" />
            <span>Apply</span>
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">
          QR codes and links prefill only the room ID—enter the source PIN to authenticate.
        </p>
      </div>
    </section>
  );
}
