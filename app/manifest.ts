import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AudioDrop',
    short_name: 'AudioDrop',
    description: 'Download and sync audio from YouTube',
    start_url: '/',
    display: 'standalone',
    background_color: '#090b10',
    theme_color: '#090b10',

    icons: [
      {
        src: '/icons/audiodrop.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}