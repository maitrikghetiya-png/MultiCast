export function BrandMark() {
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient
            id="multicast-red-grad"
            x1="2"
            y1="2"
            x2="26"
            y2="26"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#DC2626" />
            <stop offset="100%" stopColor="#E11D48" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="4"
          width="17"
          height="13"
          rx="3"
          stroke="url(#multicast-red-grad)"
          strokeWidth="2"
        />
        <rect
          x="9"
          y="11"
          width="17"
          height="13"
          rx="3"
          fill="#FFFFFF"
          stroke="url(#multicast-red-grad)"
          strokeWidth="2"
        />
        <circle cx="17.5" cy="17.5" r="2.1" fill="url(#multicast-red-grad)" />
      </svg>
      <span className="font-display text-base font-bold tracking-tight text-zinc-950">
        Multi<span className="text-red-600">Cast</span>
      </span>
    </span>
  );
}
