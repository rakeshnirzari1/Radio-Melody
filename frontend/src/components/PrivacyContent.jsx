import React, { useState } from "react";
import { ShieldCheck, Trash2, Code2, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PROXY_URL } from "../lib/radioApi";
import { clearHealth, healthSummary } from "../lib/health";

const STORAGE_KEYS = [
  "rm_favorites_v1",
  "rm_history_v1",
  "rm_ads_v1",
  "rm_https_probe_v1",
  "rm_station_health_v1",
  "rm_world_v1",
  "rm_ad_interval_min",
  "rm_install_snooze_v1",
];

export const PRIVACY_POINTS = [
  "No account, no sign-up, no email — there is nothing to register.",
  "No analytics, no tracking pixels, no advertising IDs, no fingerprinting.",
  "Your favourites, history, listening progress and \"stations that failed\" list stay in this browser's own storage. They are never uploaded, and clearing your browser data erases them.",
  "The only cookies are the ones the radio servers themselves set while you listen; we do not read or store them.",
  "Location is used only to pick the station nearest you, only if you allow it, and only in the page — it is never transmitted to us.",
  "Ads are played from a folder on our own website. No ad network, no third-party ad code, no targeting.",
];

const PrivacyContent = ({ onOpenPrivacyPage }) => {
  const [copied, setCopied] = useState(false);
  const embedSnippet = `<iframe src="${window.location.origin}${process.env.PUBLIC_URL || ""}/embed/station-id" width="320" height="150" frameborder="0" title="World Radio player"></iframe>`;

  return (
    <div className="rm-scroll flex-1 overflow-y-auto px-5 pb-6 text-sm leading-relaxed text-[#aebfb7]">
      <div className="mb-4 flex items-center gap-2 text-[#7bf0b8]">
        <ShieldCheck size={17} />
        <span className="font-display text-base font-600 text-white">
          No accounts. No tracking. Nothing to sell.
        </span>
      </div>

      <ul className="mb-5 space-y-2.5">
        {PRIVACY_POINTS.map((p) => (
          <li key={p} className="flex gap-2">
            <Check size={14} className="mt-1 flex-shrink-0 text-[#2fe08a]" />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-[#6f857b]">
          What leaves your device
        </div>
        <p className="text-xs leading-relaxed">
          Station lists and search come from the community-run Radio-Browser API, so
          your browser asks it for stations directly. Audio is fetched straight from
          the broadcaster.{" "}
          {PROXY_URL
            ? "A small Cloudflare Worker we run relays http-only audio, favicons and song titles — it holds nothing and logs nothing beyond what Cloudflare keeps by default."
            : "No relay is configured, so there are no other third parties at all."}{" "}
          That is the entire list.
        </p>
      </div>

      <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-[#6f857b]">
          <Code2 size={12} /> Embed a station
        </div>
        <p className="mb-2 text-xs leading-relaxed">
          Put any station on your own site. Open a station, press Share, and take the
          id from the link — or paste this and swap in the id.
        </p>
        <pre className="rm-scroll overflow-x-auto rounded-xl bg-black/40 p-3 text-[10px] leading-relaxed text-[#9fb3aa]">
{embedSnippet}
        </pre>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(embedSnippet);
              setCopied(true);
              toast.success("Embed code copied");
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Couldn't copy");
            }
          }}
          className="mt-2 flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-[#cfe8dd] transition-colors hover:bg-white/10"
        >
          {copied ? <Check size={13} /> : <Code2 size={13} />}
          {copied ? "Copied" : "Copy embed code"}
        </button>
      </div>

      <button
        onClick={() => {
          Object.keys(window.localStorage)
            .filter((k) => k.startsWith("rm_") || STORAGE_KEYS.includes(k))
            .forEach((k) => window.localStorage.removeItem(k));
          clearHealth();
          toast.success("Everything this site stored is gone", {
            description: "Favourites, history and progress were cleared.",
          });
        }}
        className="flex items-center gap-2 rounded-full bg-white/5 px-3.5 py-2 text-xs text-[#9fb3aa] transition-colors hover:bg-rose-500/15 hover:text-rose-300"
      >
        <Trash2 size={13} /> Erase everything stored on this device
      </button>

      {onOpenPrivacyPage && (
        <button
          onClick={onOpenPrivacyPage}
          className="mt-3 flex items-center gap-1.5 text-xs text-[#6f857b] transition-colors hover:text-[#7bf0b8]"
        >
          <ExternalLink size={12} /> Full privacy note
        </button>
      )}

      <p className="mt-5 text-[11px] text-[#5f7a6e]">
        {healthSummary().known
          ? `${healthSummary().known} stations have been scored on this device to avoid re-offering dead ones.`
          : "Station health scoring starts once you have played a few stations."}
      </p>
    </div>
  );
};

export default PrivacyContent;
