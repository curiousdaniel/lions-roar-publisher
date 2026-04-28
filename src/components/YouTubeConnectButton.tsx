import Link from "next/link";

export function YouTubeConnectButton({ connected }: { connected: boolean }) {
  if (connected) {
    return <p className="text-sm text-green-700">YouTube connected</p>;
  }

  return (
    <Link href="/api/youtube/auth" className="inline-flex rounded-md bg-red-600 px-3 py-2 text-sm text-white">
      Connect YouTube Account
    </Link>
  );
}
