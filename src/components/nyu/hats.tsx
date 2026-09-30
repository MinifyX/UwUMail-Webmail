import type { Hat } from "./cameo";
import { NYU } from "./Nyu";

const SANTA = "#F0525E";

/** Hats in Nyu's own coordinates, where the top edge of the body is at y = 152. */
export function NyuHat({ hat }: { hat: Hat }) {
  const line = { stroke: NYU.ink, strokeWidth: 14, strokeLinejoin: "round" as const };
  if (hat === "party") {
    return (
      <g>
        <path d="M188 170 L266 26 L330 164 Q260 184 188 170Z" fill={NYU.mint} {...line} />
        <path d="M224 104 Q262 116 300 100 M204 140 Q262 156 318 136" fill="none" stroke={NYU.body} strokeWidth={14} />
        <circle cx="266" cy="26" r="20" fill={NYU.star} {...line} />
      </g>
    );
  }
  if (hat === "santa") {
    return (
      <g>
        <path d="M184 160 Q210 40 300 52 Q372 62 392 128 L360 138 Q344 96 318 92 L334 160Z" fill={SANTA} {...line} />
        <circle cx="378" cy="146" r="22" fill={NYU.paper} {...line} />
        <rect x="168" y="140" width="184" height="40" rx="20" fill={NYU.paper} {...line} />
      </g>
    );
  }
  return (
    <g>
      <path d="M176 172 Q196 44 318 60 Q360 70 358 176Z" fill={NYU.sky} {...line} />
      <path d="M318 62 Q170 30 104 118 L128 134 Q176 82 262 76Z" fill={NYU.sky} {...line} />
      <path d="M204 110 Q260 96 330 114 M190 146 Q264 130 350 150" fill="none" stroke={NYU.paper} strokeWidth={14} />
      <circle cx="102" cy="134" r="22" fill={NYU.star} {...line} />
      <rect x="160" y="152" width="212" height="36" rx="18" fill={NYU.lilac} {...line} />
    </g>
  );
}
