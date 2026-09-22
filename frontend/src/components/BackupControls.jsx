import React, { useRef, useState } from "react";
import { Download, Upload, Copy, KeyRound, ShieldCheck } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { buildBackup, parseBackup } from "../lib/backup";
import { toast } from "sonner";

/**
 * Favourites backup: a file, a pasteable code, and the import door.
 *
 * The import side is treated as hostile input — see lib/backup.js for what is checked.
 * Everything that arrives is either a validated station or it is dropped; nothing is
 * ever evaluated, and no field is inserted as markup.
 */
const BackupControls = () => {
  const { favorites, importFavorites } = usePlayer();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const fileRef = useRef(null);

  const applyImport = (text) => {
    const { items, error, dropped, blocked, checksumMismatch } = parseBackup(text);
    if (error || !items.length) {
      toast.error("Import failed", { description: error || "No valid stations in it." });
      return;
    }
    importFavorites(items);
    const notes = [];
    if (dropped) notes.push(`${dropped} invalid entr${dropped === 1 ? "y" : "ies"} skipped`);
    if (blocked) notes.push(`${blocked} blocked station${blocked === 1 ? "" : "s"} skipped`);
    if (checksumMismatch) notes.push("the code looked truncated — check the list came through");
    toast.success(`${items.length} favourites imported`, {
      description: notes.length ? notes.join(", ") : undefined,
    });
    setCode("");
  };

  const exportFile = () => {
    const { json, count } = buildBackup(favorites);
    if (!count) {
      toast.error("No favourites to export yet");
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radio-melody-favourites-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast.success(`${count} favourite${count === 1 ? "" : "s"} exported`, {
      description: "Keep the file somewhere safe.",
    });
  };

  const copyCode = async () => {
    const { code: built, count } = buildBackup(favorites);
    if (!count) {
      toast.error("No favourites to export yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(built);
      toast.success(`${count} favourites copied as a backup code`, {
        description: "Paste it into Import on your other phone.",
      });
    } catch {
      setOpen(true);
      setCode(built);
      toast.message("Copy this code", { description: "Select it and copy by hand." });
    }
  };

  return (
    <div className="mb-3 rounded-xl bg-white/[0.03] p-2.5 ring-1 ring-white/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left text-xs font-600 text-[#cfe8dd]"
      >
        <span className="flex items-center gap-1.5">
          <KeyRound size={13} className="text-[#2fe08a]" /> Backup &amp; move your favourites
        </span>
        <span className="text-[#7f9a90]">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="mt-2.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={exportFile}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-500 text-[#cfe8dd] hover:bg-white/10"
            >
              <Download size={12} /> Save file
            </button>
            <button
              type="button"
              onClick={copyCode}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-500 text-[#cfe8dd] hover:bg-white/10"
            >
              <Copy size={12} /> Copy backup code
            </button>
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-[11px] font-500 text-[#cfe8dd] hover:bg-white/10"
            >
              <Upload size={12} /> Import file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > 400000) {
                  toast.error("That file is too large to be a favourites backup");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => applyImport(String(reader.result || ""));
                reader.onerror = () => toast.error("Couldn't read that file");
                reader.readAsText(file);
              }}
            />
          </div>

          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="…or paste a backup code / JSON here"
            rows={3}
            spellCheck={false}
            className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-[#cfe8dd] placeholder:text-[#5d726a]"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[10px] text-[#6f857b]">
              <ShieldCheck size={11} /> Checked field by field. Nothing here can run code.
            </span>
            <button
              type="button"
              onClick={() => applyImport(code)}
              disabled={!code.trim()}
              className="rounded-full bg-[#2fe08a]/15 px-3 py-1.5 text-[11px] font-600 text-[#7bf0b8] transition-colors hover:bg-[#2fe08a]/25 disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupControls;
