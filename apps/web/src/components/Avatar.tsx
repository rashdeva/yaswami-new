// Аватарка человека в шапке разделов: по нажатию — профиль. Фото — из Telegram; без него — первая буква имени;
// гость без входа — серый силуэт.
import { useNavigate } from '@tanstack/react-router';
import { useSession } from '../hooks/useSession.ts';
import { haptic, tg } from '../tg.ts';

export function Avatar({ big }: { big?: boolean }) {
  const { me } = useSession();
  const photo = tg?.initDataUnsafe.user?.photo_url;
  const name = me?.user.first_name;
  return (
    <span className={big ? 'avatar big' : 'avatar'} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : name ? name[0]!.toUpperCase() : (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4" /><path d="M4.5 21c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" /></svg>
      )}
    </span>
  );
}

/** Кнопка-аватарка справа в шапке раздела. */
export function ProfileButton() {
  const navigate = useNavigate();
  return (
    <button className="profile-btn" aria-label="Профиль" onClick={() => { haptic.select(); void navigate({ to: '/my' }); }}>
      <Avatar />
    </button>
  );
}
