import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  dark?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  dark = false,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 max-w-md mx-auto">
      <div
        className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl border ${
          dark
            ? 'border-zinc-800 bg-zinc-900 text-red-400'
            : 'border-red-100 bg-red-50/70 text-red-600'
        }`}
      >
        {icon}
      </div>
      <h3
        className={`text-sm font-semibold ${
          dark ? 'text-zinc-100' : 'text-zinc-900'
        }`}
      >
        {title}
      </h3>
      <p
        className={`mt-1.5 text-sm leading-relaxed ${
          dark ? 'text-zinc-400' : 'text-zinc-600'
        }`}
      >
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
