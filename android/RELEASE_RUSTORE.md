# ECHO — подготовка подписанной APK для RuStore

Дата подготовки: 25 октября 2026. Ветка: `apk`.
Пакет Android: **`ru.echogame.arena`**.
Первая версия для магазина: **`1.0.0`**, `versionCode = 19`, Android 8.0+, targetSdk 35.

> Подготовлена **инфраструктура** релизной сборки. До создания закрытого
> ключа разработчиком и настройки GitHub Secrets **подписанная APK не существует**.
> Никакие релизные сертификаты не создавайте внутри репозитория или чата.

## 1. Создайте ключ один раз и храните его всегда

Для **первой** публикации ECHO в RuStore нужен постоянный личный ключ
подписи Android. Для дальнейших обновлений используйте **тот же ключ**,
тот же `applicationId` и больший `versionCode`.

Можно создать его через Android Studio:
**Build → Generate Signed Bundle / APK → APK → Create new…**
или локально через JDK (вне папки репозитория):

```bash
keytool -genkeypair -v -keystore echo-release.jks -storetype JKS -alias echo-release -keyalg RSA -keysize 3072 -validity 10000
```

Задайте длинный уникальный пароль keystore; сохраните пароль и пароль ключа,
его alias (`echo-release`) и исходный `echo-release.jks`. Сделайте минимум
две **защищённые** резервные копии ключа и паролей, не пересылайте их
в переписке, не публикуйте файл и не помещайте его в Git.

Если **когда-либо уже публиковали именно `ru.echogame.arena`**, создавать
новый ключ нельзя: используйте тот, которым подписана опубликованная версия.

## 2. Настройте секреты в GitHub

Откройте GitHub →
**m1lker-go/echo-game → Settings → Secrets and variables → Actions →
Repository secrets**. Создайте:

| Secret | Значение |
| --- | --- |
| `ECHO_RELEASE_KEYSTORE_BASE64` | Полный Base64 файла `echo-release.jks`, без переносов строк |
| `ECHO_RELEASE_STORE_PASSWORD` | Пароль хранилища ключей |
| `ECHO_RELEASE_KEY_ALIAS` | Alias ключа, например `echo-release` |
| `ECHO_RELEASE_KEY_PASSWORD` | Пароль отдельного ключа; может совпадать с паролем хранилища |
| `ECHO_VK_CLIENT_SECRET` | Уже используемый **Android VK ID** ключ ECHO, не от Cat Fighting |

Base64 на Windows PowerShell (локально, файл вне Git):

```powershell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("C:\\safe\\echo-release.jks"))
```

На Linux:

```bash
base64 -w 0 /safe/echo-release.jks
```

**Base64 — это не шифрование.** Не публикуйте результат.
GitHub Actions временно восстанавливает JKS в `$RUNNER_TEMP`,
подписывает APK и удаляет JKS. Значения паролей не сохраняются
в исходниках и артефакте.

Обратите внимание: `ECHO_GOOGLE_CLIENT_ID`, `ECHO_GOOGLE_CLIENT_SECRET`,
`ECHO_YANDEX_CLIENT_ID` и `ECHO_YANDEX_CLIENT_SECRET` остаются
**на VPS ECHO**, а не в Android APK. Их на GitHub добавлять не требуется.

## 3. Получите SHA-1 релизного сертификата и настройте VK ID

На компьютере владельца ключа:

```bash
keytool -list -v -keystore echo-release.jks -alias echo-release
```

Найдите **SHA1** (при необходимости и SHA256), затем внесите
отпечаток **релизной подписи** в Android-настройки приложения ECHO
в кабинете VK ID для `ru.echogame.arena`. Не путайте с debug SHA-1,
который использовался при тестах в Android Studio.

Без корректно зарегистрированного релизного сертификата
VK/OK/Mail ID могут перестать работать в опубликованной APK.
Проверьте вход всеми пятью способами на **подписанной** сборке.

## 4. Соберите Release APK

Создан отдельный workflow:
`.github/workflows/android-release.yml` — **Build signed ECHO RuStore APK**.

Он **не запускается при обычном push в `apk`**. Запустите вручную через
GitHub Actions (выбрав `apk`, если workflow доступен), либо
создайте и отправьте git-тег формата `echo-v1.0.0` на проверенном
коммите ветки `apk`. Для `workflow_dispatch` GitHub может требовать
наличия файла workflow на default branch; надёжный вариант с workflow,
хранящимся только в `apk`, — запуск по git-тегу.

```bash
git checkout apk
git pull
git tag echo-v1.0.0
git push origin echo-v1.0.0
```

**Не ставьте тег, пока не добавлены секреты и не закончены проверки игры.**

Workflow:
- проверяет ECHO Android-авторизацию и конфигурацию;
- отказывается собирать релиз при отсутствии любого секрета;
- компилирует `assembleRelease`, не `assembleDebug`;
- проверяет подпись `apksigner verify`, пакет `ru.echogame.arena`,
  версию 1.0.0 (код 19), отсутствие `android:debuggable`;
- загружает только успешно проверенный **`ECHO-1.0.0-rustore-release.apk`**
  как артефакт `echo-rustore-signed-v1.0.0`.

Стандартная сборка `android-apk.yml` продолжает создавать DEBUG APK
для тестирования отдельно.

## 5. Важно при установке на телефон

Debug APK и RuStore Release APK подписаны **разными** сертификатами:
поверх debug APK релиз может не установиться. Обычно debug APK нужно
удалить и затем установить релиз. На устройстве при этом может исчезнуть
локальный кеш и вход, поэтому сперва убедитесь, что игровой прогресс
сохранён в **авторизованном** аккаунте ECHO на сервере.

Проверьте именно релиз:
- запуск, ландшафтный экран, WebView Arena, персонажи, магазин, задания;
- VK / Одноклассники / Mail.ru / Яндекс ID / Google,
  повторный вход, выход, удаление аккаунта;
- награды, платные покупки Robokassa и статус заказа/возврата;
- две рекламные интеграции myTarget: interstitial + rewarded,
  включая сценарии без рекламы/без интернета;
- Android 8+, современные Android, устройства с разными разрешениями;
- переключение языка, фоновая музыка, кнопка Назад и закрытие арены.

## 6. Подготовьте карточку RuStore и правовые страницы

В RuStore для приложения, обрабатывающего данные игроков, требуется
**публичная политика конфиденциальности на русском языке, доступная
и в карточке, и внутри приложения**. Не придумывайте оператора данных,
контакт или юридические сведения: сначала заполните реальные данные
ответственного лица. В текущем ECHO-коде отдельная публичная политика
не обнаружена — её ещё необходимо разработать, опубликовать и связать
с нативными Настройками и карточкой магазина.

Также требуются описание игры, иконка, реальные скриншоты **из APK**,
возрастная категория, поддержка/контакт, политика данных,
информация об использованных SDK, рекламе и монетизации.
У ECHO гибридный WebView, поэтому перед отправкой обязательно проверьте
требование RuStore о дополнительной нативной функциональности: сам сайт,
обёрнутый в WebView без интеграции с устройством, не допускается.

## Официальная документация RuStore

- Публикация и APK: https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication
- Подписи: https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication/apk-signature
- Требования: https://www.rustore.ru/help/developers/publishing-and-verifying-apps/requirement-apps
