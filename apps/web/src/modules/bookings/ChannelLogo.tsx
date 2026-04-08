import Image from "next/image";

type ChannelValue = string | null | undefined;

type Props = {
  channel: ChannelValue;
  className?: string;
};

export function ChannelLogo({ channel, className }: Props) {
  const normalized = (channel ?? "").toLowerCase();
  if (normalized === "airbnb") {
    return (
      <span className={className} aria-hidden="true" title="Airbnb">
        <Image src="/api/assets/channel-logo/airbnb" alt="" width={14} height={14} unoptimized />
      </span>
    );
  }
  if (normalized === "booking") {
    return (
      <span className={className} aria-hidden="true" title="Booking.com">
        <Image src="/api/assets/channel-logo/booking" alt="" width={14} height={14} unoptimized />
      </span>
    );
  }
  return null;
}
