/** Реквизиты ИП для сайта (ЕГРИП на 01.04.2026). В мини-приложении Telegram не показываем: App.tsx рисует только вне Telegram. */
export function Legal() {
  return (
    <footer className="legal">
      <p>ИП Шамсудинов Рашид Ильясович</p>
      <p>ИНН 056108177486 · ОГРНИП 325050000228872</p>
      <p><a href="mailto:rash2x@gmail.com">rash2x@gmail.com</a></p>
    </footer>
  );
}
