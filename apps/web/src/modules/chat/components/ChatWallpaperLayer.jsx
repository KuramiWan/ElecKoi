import { assetSrc } from '../../../app/services/assets.js';

export function ChatWallpaperLayer({ wallpaper }) {
  if (!wallpaper?.image) return null;
  return (
    <div
      className="chat-shell-backdrop"
      aria-hidden="true"
      style={{
        "--wallpaper-opacity": wallpaper.opacity,
        "--wallpaper-blur": `${wallpaper.blur}px`,
        "--wallpaper-scrim": wallpaper.scrim,
      }}
    >
      <img src={assetSrc(wallpaper.image)} alt="" draggable="false" />
      <i />
    </div>
  );
}
