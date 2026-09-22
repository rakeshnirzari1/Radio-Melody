import React, { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { X, Copy, Download, Share2, Check } from "lucide-react";
import { toast } from "sonner";
import { stationCardCanvas, shareCard, canShareFiles } from "../lib/shareCard";

/**
 * The share sheet.
 *
 * A phone gets the native share sheet (it carries the card image straight into
 * WhatsApp); a desktop has nothing to share *to*, and the person you are sending it
 * to is usually holding the phone — so there the QR code is the useful half.
 *
 * The QR is drawn on a white tile on purpose. Inverted (light-on-dark) codes are
 * readable by some scanners and not others, and a share dialog that only works on
 * the newest phone is worse than no dialog.
 */
const ShareDialog = ({ station, link, onClose }) => {
  const canvasRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const canShare = useMemo(() => canShareFiles(), []);

  const qr = useMemo(() => {
    try {
      const q = qrcode(0, "M"); // type 0 = smallest that fits, medium error correction
      q.addData(link);
      q.make();
      return q;
    } catch {
      return null;
    }
  }, [link]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !qr) return;
    const count = qr.getModuleCount();
    const quiet = 4; // the quiet zone the spec asks for; without it scanners struggle
    const cell = Math.max(3, Math.floor(248 / (count + quiet * 2)));
    const size = (count + quiet * 2) * cell;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#05070a";
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
        }
      }
    }
  }, [qr]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link below and copy it manually");
    }
  };

  const sendCard = async () => {
    try {
      const canvas = await stationCardCanvas(station, {});
      const result = await shareCard(canvas, {
        filename: `${
          (station.name || "radio-melody")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "radio-melody"
        }.png`,
        text: `Listening to ${station.name} on World Radio`,
        url: link,
      });
      if (result === "shared") toast.success("Shared");
      if (result === "downloaded") {
        toast.success("Card saved", { description: "Link copied too." });
      }
      if (result === "failed") toast.error("Couldn't build the card");
    } catch {
      toast.error("Couldn't build the card");
    }
  };

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share this station"
    >
      <div
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0a1210] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="text-left">
            <div className="truncate text-sm font-medium text-white">{station.name}</div>
            <div className="text-[11px] text-[#7f9a90]">Scan to listen on your phone</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[#9fb3aa] transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mx-auto mb-4 flex w-full justify-center">
          <div className="rounded-2xl bg-white p-3">
            {qr ? (
              <canvas
                ref={canvasRef}
                className="block h-[176px] w-[176px]"
                aria-label="QR code for this station"
              />
            ) : (
              <div className="flex h-[176px] w-[176px] items-center justify-center text-xs text-black/60">
                Link too long for a QR code
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={sendCard}
            className="flex items-center gap-1.5 rounded-full bg-[#2fe08a]/15 px-3.5 py-2 text-xs font-medium text-[#7bf0b8] transition-colors hover:bg-[#2fe08a]/25"
          >
            {canShare ? <Share2 size={14} /> : <Download size={14} />}
            {canShare ? "Share" : "Save card"}
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-3.5 py-2 text-xs font-medium text-[#cfe8dd] transition-colors hover:bg-white/10"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>

        <div className="mt-4 break-all rounded-xl bg-black/30 px-3 py-2 text-[10px] leading-relaxed text-[#7f9a90]">
          {link}
        </div>
      </div>
    </div>
  );
};

export default ShareDialog;
