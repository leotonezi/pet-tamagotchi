interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-300">
      <span className="mt-0.5 text-red-400">&#9888;</span>
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-red-400 hover:text-red-200"
          aria-label="Dismiss"
        >
          &#10005;
        </button>
      )}
    </div>
  );
}
