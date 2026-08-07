import Image from 'next/image';
import logo from '@/public/images/logo.jpg';

export function Logo({ size = 72 }: { size?: number }) {
  return (
    <Image
      src={logo}
      alt="Fuerza Aérea del Perú"
      width={size}
      height={size}
      className="logo"
      priority
    />
  );
}
