package ru.echo.game

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.grayscale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Match the live client/echo-font.css and menu styles rather than creating a
// second ECHO visual identity. Assets are copied from main without editing them.
private val EchoFont = FontFamily(Font(R.font.echo_superxp))
private val White = Color(0xFFF1F4F7)
private val Secondary = Color(0xFF909AA7)
private val Outline = Color(0xFFE6EAF0)
private val Black = Color(0xFF000000)
private val Cyan = Color(0xFFB6EBFF)
private val QuestBorder = Color(0xFF4A5967)

@Composable
internal fun EchoAndroidShell() {
    var page by remember { mutableStateOf(Page.HOME) }
    val back: () -> Unit = {
        page = when (page) {
            Page.HERO_VIEW -> Page.HEROES
            Page.PACK_VIEW -> Page.SHOP
            else -> Page.HOME
        }
    }
    BackHandler(enabled = page != Page.HOME, onBack = back)
    when (page) {
        Page.ARENA, Page.HERO_VIEW, Page.PACK_VIEW -> WebPage(page, back)
        else -> EchoNativePage(page, onNavigate = { page = it }, onBack = back)
    }
}

@Composable
private fun EchoSpaceBackground(content: @Composable () -> Unit) {
    val transition = rememberInfiniteTransition(label = "echo-space")
    val phase by transition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(14000, easing = LinearEasing), RepeatMode.Restart),
        label = "food-drift"
    )
    Box(Modifier.fillMaxSize().background(Black)) {
        Canvas(Modifier.fillMaxSize()) {
            // The original website animates a field of pale food particles on black.
            // Stable positions keep Compose recompositions from rearranging the scene.
            repeat(46) { i ->
                val x = ((i * 0.6180339f + 0.11f) % 1f) * size.width
                val y = ((i * 0.41421356f + phase * (0.014f + i % 3 * .006f)) % 1f) * size.height
                val pulse = 0.55f + .45f * kotlin.math.sin(phase * 6.28318f + i * 1.91f)
                val radius = (1.1f + i % 4 * .55f) * density
                drawCircle(White.copy(alpha = .055f * pulse), radius = radius * 4, center = Offset(x, y))
                drawCircle(White.copy(alpha = .25f + .42f * pulse), radius = radius, center = Offset(x, y))
            }
        }
        content()
    }
}

@Composable
private fun EchoText(
    text: String,
    size: Int = 17,
    color: Color = White,
    modifier: Modifier = Modifier,
    centered: Boolean = false,
    weight: FontWeight = FontWeight.Normal,
    maxLines: Int = Int.MAX_VALUE
) {
    Text(
        text = text, modifier = modifier, color = color, fontFamily = EchoFont,
        fontWeight = weight, fontSize = size.sp, lineHeight = (size * 1.18f).sp,
        textAlign = if (centered) TextAlign.Center else TextAlign.Start,
        maxLines = maxLines, overflow = TextOverflow.Ellipsis
    )
}

@Composable
private fun EchoButton(
    text: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    height: Dp = 48.dp,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(12.dp)
    Box(
        modifier = modifier.height(height).clip(shape)
            .background(if (selected) White else Black)
            .border(1.dp, Outline, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        EchoText(text, 19, if (selected) Black else White, centered = true, weight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
private fun EchoPageHeader(title: String, description: String? = null) {
    EchoText(title, size = 27, modifier = Modifier.fillMaxWidth(), centered = true, weight = FontWeight.SemiBold)
    if (!description.isNullOrEmpty()) {
        Spacer(Modifier.height(4.dp))
        EchoText(description, 14, Secondary, Modifier.fillMaxWidth(), centered = true)
    }
}

@Composable
private fun EchoNativePage(page: Page, onNavigate: (Page) -> Unit, onBack: () -> Unit) {
    EchoSpaceBackground {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // In client/menu-width.css every page is constrained to 100dvh in landscape.
            val contentWidth = minOf(maxHeight, maxWidth - 36.dp)
            if (page == Page.HOME) {
                Column(
                    Modifier.align(Alignment.Center).width(contentWidth)
                        .fillMaxHeight().verticalScroll(rememberScrollState())
                        .padding(vertical = 8.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    EchoText("ЭХО.", 52, modifier = Modifier.fillMaxWidth(), centered = true, weight = FontWeight.Bold)
                    Spacer(Modifier.height(17.dp))
                    EchoButton("НАЧАТЬ ИГРУ", Modifier.fillMaxWidth()) { onNavigate(Page.ARENA) }
                    Spacer(Modifier.height(8.dp))
                    EchoButton("ПЕРСОНАЖ", Modifier.fillMaxWidth()) { onNavigate(Page.HEROES) }
                    Spacer(Modifier.height(8.dp))
                    EchoButton("МАГАЗИН", Modifier.fillMaxWidth()) { onNavigate(Page.SHOP) }
                    Spacer(Modifier.height(8.dp))
                    EchoButton("ЗАДАНИЯ", Modifier.fillMaxWidth()) { onNavigate(Page.QUESTS) }
                    Spacer(Modifier.height(8.dp))
                    EchoButton("НАСТРОЙКИ", Modifier.fillMaxWidth()) { onNavigate(Page.SETTINGS) }
                }
            } else {
                Column(
                    modifier = Modifier.align(Alignment.Center)
                        .width(contentWidth).fillMaxHeight()
                        .padding(top = 8.dp, bottom = 9.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    when (page) {
                        Page.HEROES -> EchoPageHeader("ПЕРСОНАЖ", "Выбери героя для игры")
                        Page.SHOP -> EchoShopHeader()
                        Page.QUESTS -> EchoPageHeader("ЗАДАНИЯ")
                        Page.ACCOUNT -> EchoPageHeader("АККАУНТ")
                        Page.SETTINGS -> EchoPageHeader("НАСТРОЙКИ")
                        else -> Unit
                    }
                    Spacer(Modifier.height(8.dp))
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
                        when (page) {
                            Page.HEROES -> EchoHeroes(onNavigate)
                            Page.SHOP -> EchoShop(onNavigate, maxHeight)
                            Page.QUESTS -> EchoQuests()
                            Page.ACCOUNT -> EchoAccount()
                            Page.SETTINGS -> EchoSettings(onNavigate)
                            else -> Unit
                        }
                    }
                    Spacer(Modifier.height(7.dp))
                    EchoButton("НАЗАД", Modifier.fillMaxWidth(), height = 44.dp, onClick = onBack)
                }
            }
        }
    }
}

private data class EchoHero(val name: String, val rarity: String)
private val heroes = listOf(
    EchoHero("Костыль", "common"), EchoHero("Девчонка", "common"),
    EchoHero("Бабуся", "common"), EchoHero("Бизнес леди", "uncommon"),
    EchoHero("Медсестра", "common"), EchoHero("Хвостики", "common"),
    EchoHero("Зоркий", "common"), EchoHero("Дедок", "uncommon"),
    EchoHero("Полицай", "rare"), EchoHero("Бизнесмен", "rare"),
    EchoHero("Учёный", "uncommon"), EchoHero("Злюка", "uncommon"),
    EchoHero("Призрак", "legendary"), EchoHero("Фермер", "rare"),
    EchoHero("Скелет", "legendary"), EchoHero("Зомби", "epic"),
    EchoHero("Воин", "rare"), EchoHero("Орк", "epic")
)
private fun heroCardArt(rarity: String) = when (rarity) {
    "uncommon" -> R.drawable.echo_card_uncommon
    "rare" -> R.drawable.echo_card_rare
    "epic" -> R.drawable.echo_card_epic
    "legendary" -> R.drawable.echo_card_legend
    else -> R.drawable.echo_card_common
}
private fun rarityLabel(rarity: String) = when (rarity) {
    "uncommon" -> "НЕОБЫЧНЫЙ"
    "rare" -> "РЕДКИЙ"
    "epic" -> "ЭПИЧЕСКИЙ"
    "legendary" -> "ЛЕГЕНДАРНЫЙ"
    else -> "ОБЫЧНЫЙ"
}
private fun rarityColor(rarity: String) = when (rarity) {
    "uncommon" -> Color(0xFF28865A)
    "rare" -> Color(0xFF166AAF)
    "epic" -> Color(0xFF743CAD)
    "legendary" -> Color(0xFFAD7C25)
    else -> Color(0xFF26303D)
}

@Composable
private fun EchoHeroes(onNavigate: (Page) -> Unit) {
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        EchoText(
            "Карточки и редкость — как в веб-игре. 3D-галерея открывается отдельно.",
            11, Secondary, Modifier.fillMaxWidth(), centered = true
        )
        Spacer(Modifier.height(6.dp))
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            modifier = Modifier.weight(1f).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            items(heroes) { hero ->
                Box(
                    Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                        .clip(RoundedCornerShape(9.dp))
                        .border(1.dp, Color(0xFFB5C9DD).copy(alpha = .7f), RoundedCornerShape(9.dp))
                        .clickable { onNavigate(Page.HERO_VIEW) }
                ) {
                    Image(
                        painter = painterResource(heroCardArt(hero.rarity)), contentDescription = null,
                        modifier = Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds
                    )
                    // The GLB models are intentionally not rendered in 18 native
                    // contexts. The existing shared Three.js renderer stays in WebView.
                    Box(
                        Modifier.fillMaxWidth().fillMaxHeight(.60f).align(Alignment.TopCenter),
                        contentAlignment = Alignment.Center
                    ) { EchoText("3D", 14, White.copy(alpha = .75f), centered = true) }
                    Column(
                        Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 7.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Box(Modifier.fillMaxWidth(.80f).background(rarityColor(hero.rarity), RoundedCornerShape(3.dp)).padding(vertical = 3.dp), contentAlignment = Alignment.Center) {
                            EchoText(rarityLabel(hero.rarity), 8, centered = true, maxLines = 1)
                        }
                        Spacer(Modifier.height(5.dp))
                        EchoText(hero.name, 12, modifier = Modifier.fillMaxWidth().padding(horizontal = 3.dp), centered = true, maxLines = 2)
                    }
                }
            }
        }
        Spacer(Modifier.height(7.dp))
        EchoButton("ОТКРЫТЬ 3D-ГАЛЕРЕЮ", Modifier.fillMaxWidth(), height = 39.dp) {
            onNavigate(Page.HERO_VIEW)
        }
    }
}

@Composable
private fun EchoShopHeader() {
    EchoPageHeader("МАГАЗИН")
    Spacer(Modifier.height(2.dp))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        EchoText("Баланс: —", 18)
        Spacer(Modifier.width(6.dp))
        Image(painterResource(R.drawable.echo_coin), contentDescription = "ECHO Coin", modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun EchoPackCard(art: Int, price: String, coin: Boolean, width: Dp, onClick: () -> Unit) {
    Column(
        Modifier.width(width).clip(RoundedCornerShape(16.dp))
            .border(1.5.dp, White, RoundedCornerShape(16.dp))
            .background(Black)
    ) {
        Image(
            painter = painterResource(art), contentDescription = null,
            contentScale = ContentScale.FillBounds,
            modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)
        )
        Box(
            Modifier.fillMaxWidth().height(43.dp)
                .border(0.5.dp, White).clickable(onClick = onClick),
            contentAlignment = Alignment.Center
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                EchoText(price, 18, centered = true)
                if (coin) {
                    Spacer(Modifier.width(6.dp))
                    Image(painterResource(R.drawable.echo_coin), null, Modifier.size(23.dp))
                }
            }
        }
    }
}

@Composable
private fun EchoShop(onNavigate: (Page) -> Unit, screenHeight: Dp) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val packWidth = minOf((maxWidth - 14.dp) / 2, screenHeight * .36f)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                EchoPackCard(R.drawable.echo_pack_basic, "50", true, packWidth) { onNavigate(Page.PACK_VIEW) }
                EchoPackCard(R.drawable.echo_pack_special, "250 ₽", false, packWidth) { onNavigate(Page.PACK_VIEW) }
            }
            Spacer(Modifier.height(5.dp))
            EchoText(
                "Покупка откроется в веб-витрине. Android-платежи пока не подключены.",
                11, Secondary, modifier = Modifier.fillMaxWidth(), centered = true
            )
        }
    }
}

private data class EchoQuestTemplate(val title: String, val hint: String, val mark: String)
private val questTemplates = listOf(
    EchoQuestTemplate("Часовой", "Проводи время в поединках", "◷"),
    EchoQuestTemplate("Собиратель", "Собирай энергию на арене", "✦"),
    EchoQuestTemplate("Победитель", "Побеждай соперников в PvP", "★"),
    EchoQuestTemplate("Обычный пак", "Открывай обычные паки", "▣"),
    EchoQuestTemplate("Премиум пак", "Открывай премиум паки", "◆")
)

@Composable
private fun EchoQuests() {
    var special by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            EchoButton("ЕЖЕДНЕВНЫЕ", Modifier.weight(1f), selected = !special, height = 38.dp) { special = false }
            EchoButton("ОСОБЫЕ", Modifier.weight(1f), selected = special, height = 38.dp) { special = true }
        }
        Spacer(Modifier.height(5.dp))
        EchoText(if (special) "Специальные награды ECHO" else "Обновление ежедневно в 00:00 по Москве",
            12, Secondary, modifier = Modifier.fillMaxWidth(), centered = true)
        Spacer(Modifier.height(8.dp))
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (special) {
                EchoQuestCard("Специальное задание", "Привяжи аккаунт, чтобы увидеть активное задание", "◆")
            } else {
                questTemplates.forEach { quest -> EchoQuestCard(quest.title, quest.hint, quest.mark) }
            }
        }
        EchoText("Прогресс и получение наград появятся после подключения авторизации.",
            11, Secondary, modifier = Modifier.fillMaxWidth().padding(top = 5.dp), centered = true)
    }
}

@Composable
private fun EchoQuestCard(title: String, hint: String, mark: String) {
    Column(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xCC03090F))
            .border(1.dp, QuestBorder.copy(alpha = .7f), RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 9.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            EchoText(mark, 22, Cyan)
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                EchoText(title, 19, weight = FontWeight.SemiBold)
                EchoText(hint, 12, Color(0xFFC9D7E6))
            }
            Image(painterResource(R.drawable.echo_coin), "Награда", Modifier.size(23.dp))
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(6.dp).background(Color(0xFF23323C), RoundedCornerShape(6.dp)))
        Spacer(Modifier.height(6.dp))
        EchoText("Прогресс: —", 11, Secondary)
    }
}

@Composable
private fun EchoAccount() {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        EchoText("ИГРОВОЙ ПРОФИЛЬ", 22, centered = true, weight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        EchoText("ГОСТЬ", 21, centered = true)
        Spacer(Modifier.height(14.dp))
        EchoText(
            "Для синхронизации имени, коллекции, баланса и заданий требуется подключить вход ECHO к Android.",
            15, Secondary, Modifier.fillMaxWidth(), centered = true
        )
        Spacer(Modifier.height(12.dp))
        EchoText("Вход VK ID будет добавлен отдельным этапом.", 12, Secondary, centered = true)
    }
}

@Composable
private fun EchoSettings(onNavigate: (Page) -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        EchoText("АККАУНТ", 18, Secondary, Modifier.fillMaxWidth(), centered = true)
        EchoButton("ВОЙТИ В АККАУНТ", Modifier.fillMaxWidth(), height = 44.dp) { onNavigate(Page.ACCOUNT) }
        EchoText("ЯЗЫК", 17, Secondary, Modifier.fillMaxWidth(), centered = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            EchoButton("РУССКИЙ", Modifier.weight(1f), selected = true, height = 42.dp) {}
            EchoButton("ENGLISH", Modifier.weight(1f), height = 42.dp) {}
        }
        EchoText("ЗВУК", 17, Secondary, Modifier.fillMaxWidth(), centered = true)
        EchoSettingsTile("МУЗЫКА", "Настраивается на арене")
        EchoSettingsTile("ЭФФЕКТЫ", "Настраиваются на арене")
        EchoText("Android 0.1.0 · горизонтальный экран", 12, Secondary, Modifier.fillMaxWidth(), centered = true)
    }
}

@Composable
private fun EchoSettingsTile(title: String, subtitle: String) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp))
            .background(Black).border(1.dp, QuestBorder, RoundedCornerShape(13.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        EchoText(title, 17)
        EchoText(subtitle, 12, Secondary)
    }
}
