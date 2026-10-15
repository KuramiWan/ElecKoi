import React from "react";

const OPEN_E_PATH = "M11.6 13.1V13.9H5.2V12.2H9.45C9.35 11.55 9.1 10.98 8.7 10.55C8.12 9.95 7.18 9.7 6.3 9.7C5.42 9.7 4.48 9.95 3.9 10.55C3.32 11.15 3.1 12.12 3.1 13.1C3.1 14.08 3.32 15.05 3.9 15.65C4.48 16.25 5.42 16.5 6.3 16.5C7.18 16.5 8.12 16.25 8.7 15.65L8.98 15.3H11.3C11.08 16.05 10.72 16.73 10.2 17.28C9.22 18.32 7.78 18.6 6.3 18.6C4.82 18.6 3.38 18.32 2.4 17.28C1.42 16.25 1.1 14.68 1.1 13.1C1.1 11.52 1.42 9.95 2.4 8.92C3.38 7.88 4.82 7.6 6.3 7.6C7.78 7.6 9.22 7.88 10.2 8.92C11.18 9.95 11.6 11.52 11.6 13.1Z";

export function ElecKoiWordmark({ size = 24, className = "" }) {
  return (
    <svg
      className={`eleckoi-wordmark ${className}`.trim()}
      width={size * 139.3 / 24}
      height={size}
      viewBox="0 0 139.3 24"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      role="img"
      aria-label="Eleckoi ROLEPLAY"
      focusable="false"
    >
      <g className="eleckoi-wordmark-name" transform="translate(0 0.4)">
        <path d="M3.1 4.6H11.6V6.7H4.2Q3.5 6.7 3.5 7.4V15.8Q3.5 16.5 4.2 16.5H11.6V18.6H3.1Q1.1 18.6 1.1 16.6V6.6Q1.1 4.6 3.1 4.6ZM5.2 10.7H10.8V12.5H5.2V10.7Z" />
        <path d="M14 4.6H16.4V18.6H14V4.6Z" />
        <path d={OPEN_E_PATH} transform="translate(17.6 0)" />
        <path d="M36.4 7.6C39.1 7.6 41.1 8.8 41.7 11.1H39.3C38.9 10.2 37.9 9.7 36.4 9.7C34.4 9.7 33.2 10.9 33.2 13.1C33.2 15.3 34.4 16.5 36.4 16.5C37.9 16.5 38.9 16 39.3 15.1H41.7C41.1 17.4 39.1 18.6 36.4 18.6C32.9 18.6 31.1 16.5 31.1 13.1C31.1 9.7 32.9 7.6 36.4 7.6Z" />
        <path d="M44 4.6H46.4V18.6H44V4.6ZM50.55 12.8L54.5 18.6H51.5L47.55 12.8L51.5 8.15H54.5L50.55 12.8Z" />
        <path fillRule="evenodd" d="M62 7.6C58.4 7.6 56.8 9.7 56.8 13.1C56.8 16.5 58.4 18.6 62 18.6C65.6 18.6 67.2 16.5 67.2 13.1C67.2 9.7 65.6 7.6 62 7.6ZM62 9.7C59.9 9.7 58.9 10.9 58.9 13.1C58.9 15.3 59.9 16.5 62 16.5C64.1 16.5 65.1 15.3 65.1 13.1C65.1 10.9 64.1 9.7 62 9.7Z" />
        <path d="M69.6 8.15H72V18.6H69.6V8.15Z" />
        <circle cx="70.8" cy="5.8" r="1.2" />
      </g>
      <g className="eleckoi-wordmark-roleplay">
        <rect x="79.8" y="5.5" width="58" height="14" rx="2" />
        <g
          className="eleckoi-wordmark-roleplay-letters"
          fill="none"
          stroke="var(--dsw-alias-label-primary-inverted, var(--list, #fff))"
          strokeWidth="1.2"
          strokeLinejoin="round"
        >
          <path transform="translate(84.26 9.3) scale(0.915)" d="M0 7V0H2.4C3.7 0 4.3 0.7 4.3 1.9C4.3 3.1 3.7 3.8 2.4 3.8H0M2.1 3.8L4.6 7" />
          <path transform="translate(90.87 9.3) scale(0.915)" d="M2.35 0C0.7 0 0 1.1 0 3.5C0 5.9 0.7 7 2.35 7C4 7 4.7 5.9 4.7 3.5C4.7 1.1 4 0 2.35 0Z" />
          <path transform="translate(97.57 9.3) scale(0.915)" d="M0 0V7H4" />
          <path transform="translate(103.63 9.3) scale(0.915)" d="M4 0H0V7H4M0 3.4H3.5" />
          <path transform="translate(109.69 9.3) scale(0.915)" d="M0 7V0H2.4C3.8 0 4.4 0.8 4.4 2.1C4.4 3.4 3.8 4.2 2.4 4.2H0" />
          <path transform="translate(116.11 9.3) scale(0.915)" d="M0 0V7H4" />
          <path transform="translate(122.17 9.3) scale(0.915)" d="M0 7L2.4 0L4.8 7M0.8 4.6H4" />
          <path transform="translate(128.96 9.3) scale(0.915)" d="M0 0L2.4 3.7L4.8 0M2.4 3.7V7" />
        </g>
      </g>
    </svg>
  );
}
