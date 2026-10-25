# Google и Яндекс ID для ECHO — отдельные приложения OAuth

Это **авторизация ECHO**, а не Cat Fighting: отдельные client_id / client_secret,
таблицы и токены ECHO. **Не используйте** существующие ключи Cat Fighting.

## 1. Google Cloud Console

1. Создайте новый Google Cloud project (например, `ECHO Game`).
2. В Google Auth Platform настройте бренд и экран согласия.
3. Создайте OAuth client **Web application** — обмен кодов на токены
   делает сервер ECHO, даже если вход инициирован из Android.
4. Добавьте **Authorized JavaScript origins**:
   `https://cat-fight.ru`
5. Добавьте **Authorized redirect URIs** (точное совпадение):
   `https://cat-fight.ru/echo/api/auth/oauth/google/callback`
6. Сохраните выданные **Client ID** и **Client secret**. При тестовом статусе
   укажите аккаунты тестировщиков. Для публикации потребуются домашняя страница,
   публичная политика конфиденциальности и прочие данные экрана согласия.

## 2. Яндекс OAuth

1. Откройте `https://oauth.yandex.ru/client/new/id/`.
2. Выберите приложение **«Для авторизации пользователей»** с названием ECHO.
3. Платформа: **«Веб-сервисы»** (даже для APK — код принимает сервер).
4. Redirect URI:
   `https://cat-fight.ru/echo/api/auth/oauth/yandex/callback`
5. Доступ: **`login:info`** (минимум для ID пользователя).
6. Сохраните **ClientID** и **Client secret** для отдельного приложения ECHO.

## 3. Секреты на сервере

Добавьте **только в VPS** в фактический `.env` сервера ECHO, не в GitHub и не в APK:

```env
ECHO_GOOGLE_CLIENT_ID=<Google ECHO Web OAuth Client ID>
ECHO_GOOGLE_CLIENT_SECRET=<Google ECHO Client secret>
ECHO_YANDEX_CLIENT_ID=<Yandex ECHO Client ID>
ECHO_YANDEX_CLIENT_SECRET=<Yandex ECHO Client secret>
```

Перезапустите процесс `echo-server` обычным способом, чтобы `.env` был перечитан.
Проверьте публичный **GET** `https://cat-fight.ru/echo/api/auth/config`:
`googleEnabled` и `yandexEnabled` станут `true`. Значения секретов
никогда не возвращаются клиенту.

## 4. Архитектура входа

- Web: игровая страница вызывает `POST /echo/api/auth/oauth/:provider/start`,
  открывает провайдера в popup, а сервер принимает callback. Завершение входа
  происходит через однократный HttpOnly Secure cookie и `POST .../complete`.
- Android: нативная Compose-кнопка открывает внешний браузер, **не WebView**;
  сервер возвращает временный билет через `echogame://oauth?ticket=...`.
  Билет одноразовый и связан с PKCE-проверкой, сохранённой в приложении.
  Токен ECHO никогда не помещается в URL.
- Данные Cat Fighting не используются. Впервые вошедший через Google или
  Яндекс получает **новый** ECHO-аккаунт. Совпадение email НЕ объединяет профили.
- Чтобы использовать существующие монеты, паки и скины VK-профиля,
  сначала войдите через VK, затем нажмите «Связать Google/Яндекс».
  После привязки эти способы будут входить **в тот же ECHO account_id**.
- VK Mini Apps по-прежнему автоматически использует проверенный VK launch,
  альтернативная авторизация там не предлагается.

## 5. Проверка

1. VK Mini Apps — вход через VK по умолчанию без изменений.
2. Web ECHO — Google, Яндекс, отмена, неверное состояние, повторный вход.
3. APK — открыть Google/Яндекс в системном браузере, вернуться в ECHO,
   проверить тот же nickname, баланс и персонажей.
4. Зарегистрированный VK игрок → связать Google и Яндекс → выйти →
   войти каждым методом → сохранить **тот же accountId**.
5. Удаление аккаунта тестового игрока → убедиться, что обе привязки исчезли.

Пока ключей нет, веб-кнопки Google/Яндекс скрыты. В APK выбор виден,
но сервер корректно отвечает, что вход ещё не настроен.

См. также официальные инструкции:
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://yandex.ru/dev/id/doc/ru/register-auth
