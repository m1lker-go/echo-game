// server/utils/forbiddenWords.js
const FORBIDDEN_WORDS = [
    'мат', 'хуй', 'пизда', 'бля', 'ебать', 'писька', 'хер', 'залупа', 'мудак', 'говно','член',
    'редиска', 'лох', 'сука', 'пидор', 'гнида', 'тварь', 'шлюха', 'блядина', 'еблан', 'долбоеб',
    'хуесос', 'чмо', 'мразь', 'ублюдок', 'дебил', 'идиот', 'кретин', 'придурок', 'тупица',
    'скотина', 'сволочь', 'паскуда', 'выблядок', 'курва', 'бздюх', 'пердун', 'срака', 'жопа',
    'мудила', 'пиздюк', 'хуйло', 'ебальник', 'ебарь', 'заебать', 'выебать', 'отъебаться',
    'ебашь', 'нахуй', 'охуеть', 'пиздец', 'ебанутый', 'хрен', 'хреново', 'пропиздон', 'распиздяй',
    'манда', 'мандавошка', 'петух', 'гандон', 'пидорас', 'петушара', 'сучка', 'сучонок',
    'блядки', 'блядство', 'блядовать', 'блядун', 'блядюга', 'блядюшка', 'бля', 'блин',
    'жополиз', 'засранец', 'обосраться', 'опизденеть', 'отпиздить', 'пиздабол', 'разъебать', 'съебаться', 'уебок', 'хуйня',
    'мудило', 'мудозвон', 'срач', 'срун', 'очко', 'шмар',
    'fuck', 'shit', 'bitch', 'cunt', 'dick', 'asshole', 'bastard', 'damn', 'hell', 'piss', 'crap',
    'slut', 'whore', 'cock', 'pussy', 'twat', 'motherfucker', 'faggot', 'nigger', 'retard', 'wanker',
    'bloody', 'bugger', 'arse', 'arsehole', 'bollocks', 'cocksucker', 'dumbass', 'jackass', 'douchebag',
    'douche', 'dickhead', 'shithead', 'fuckhead', 'buttface', 'turd', 'scumbag', 'sonofabitch', 'goddamn',
    'goddammit', 'horseshit', 'bullshit', 'fuckshit', 'shitfuck', 'bitchass', 'dickwad',
    'fuckface', 'asswipe', 'asshat', 'shitstain', 'cum', 'cumshot', 'cumdump', 'jizz', 'semen', 'fap',
    'masturbate', 'screw', 'screwed', 'fucking', 'shitting', 'bitching', 'motherfucking', 'goddamned',
    'noob', 'n00b', 'nooblet', 'scrub', 'pleb', 'peasant', 'fail', 'loser', 'idiot', 'moron', 'imbecile',
    'cretin', 'dumb', 'stupid', 'retarded', 'mongoloid', 'spastic', 'spaz', 'lame', 'weak', 'sucker',
    'punk', 'pussy', 'dick', 'prick', 'jerk', 'dweeb', 'geek', 'nerd', 'weirdo', 'freak', 'psycho',
    'maniac', 'bastard', 'beast', 'pig', 'dog', 'rat', 'worm', 'snake', 'vermin', 'scum', 'garbage',
    'trash', 'rubbish', 'filth', 'dirt', 'slime', 'scourge', 'plague', 'cancer', 'tumor', 'virus',
    'wtf', 'stfu', 'gtfo', 'fml', 'fuk', 'fck', 'fvck', 'phuck', 'sh1t', 'sh*t', 'b1tch', 'b*tch',
    'c0ck', 'c*nt', 'd1ck', 'd*ck', 'p0rn', 'pr0n', 'p*rn', 'a55', 'a$$', 'a*s', 'a-hole', 'ass',
    'еб', 'еба', 'ебу', 'ебё', 'ебл', 'ебн', 'ёб', 'йоб', 'йоба', 'ёба', 'ёбн', 'ёбарь', 'йопта',
    'ёпта', 'ёкарный', 'ёклмн', 'ёксель', 'ёпрст', 'ёшкин', 'йод', 'ху', 'хую', 'хуя', 'хуюшки',
    'хреновина', 'хрень', 'пизд', 'пизде', 'пиздю', 'пиздя', 'пизж', 'пизжен', 'пиздатый',
    'пиздануть', 'пиздануться', 'пиздеть', 'пиздишь', 'пиздюк', 'пиздюля', 'пиздюшник', 'пиздопроёбина',
    'ёж', 'ёжкин', 'ёженька', 'ёпт', 'ёптить',
    'dipshit', 'dumbshit', 'fucktard', 'fucknugget', 'fuckwit', 'shitbag', 'shitbrick', 'shitcanoe',
    'shitdick', 'shitface', 'shitfuck', 'shitgibbon', 'shithouse', 'shitlord', 'shitmonger', 'shitpile',
    'shitsack', 'shitshow', 'shitsipper', 'shitspitter', 'shitstain', 'shittard', 'shitwad', 'shitweasel',
    'suckass', 'suckhole', 'suckwad', 'thundercunt', 'turdball', 'turdblossom', 'turdcutter', 'turdface',
    'turdfucker', 'turdhole', 'turdslinger', 'turdtwiddler', 'whorebag', 'whoreface', 'whorehound',
    'whorehouse', 'whorelord', 'whoremonger', 'whoreson', 'whorewhacker', 'wankstain', 'wankpuffin'
];

function containsForbiddenWords(text) {
    const lower = text.toLowerCase();
    return FORBIDDEN_WORDS.some(word => lower.includes(word));
}

module.exports = { FORBIDDEN_WORDS, containsForbiddenWords };
