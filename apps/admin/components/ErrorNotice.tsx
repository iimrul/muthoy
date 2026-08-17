interface ErrorNoticeProps {
  message: string;
}

export default function ErrorNotice({ message }: ErrorNoticeProps) {
  return (
    <div role="alert" className="rounded-xl border border-error/30 bg-errorBg p-5 text-sm text-error">
      {message}
    </div>
  );
}
