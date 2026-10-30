/* Пререндер для поисковиков и ИИ-ассистентов.
   Боты ИИ (GPTBot, ClaudeBot, PerplexityBot…) обычно не выполняют JavaScript,
   поэтому кладём в HTML готовый текст: карточки комнат, «Перед сеансом», FAQ,
   плюс JSON-LD (бизнес + пакеты с ценами + FAQPage) и llms.txt.
   Запуск после любых правок: node tools/prerender.js */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const SITE = path.join(__dirname, '..', 'site'), FILE = path.join(SITE, 'index.html');
const BASE = 'https://antistress-space.kz/';

(async () => {
  let src = fs.readFileSync(FILE, 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto('file://' + FILE + '?hw=0'); await p.waitForTimeout(1500);
  const blocks = await p.evaluate(() => ({
    heroRooms: document.getElementById('heroRooms').innerHTML,
    preHome: document.getElementById('preHome').innerHTML,
    faqList: document.getElementById('faqList').innerHTML,
    faq: [...document.querySelectorAll('#faqList details')].map(d => ({
      q: d.querySelector('summary span').textContent.replace(/^[^\p{L}\d«"]+/u, '').trim(),
      a: [...d.querySelectorAll('.ans > p, .ans li')].map(x => x.textContent.trim()).join(' ')
    })),
    pre: [...document.querySelectorAll('#preHome .pre-item')].map(x => x.querySelector('b').textContent + ': ' + x.querySelector('span').textContent)
  }));
  const rooms = [];
  for (const id of ['relax', 'combo', 'antistress', 'glowbear', 'ps']) {
    await p.evaluate(h => { location.hash = h; }, '#/' + id); await p.waitForTimeout(1600);
    rooms.push(await p.evaluate(id => ({
      id, title: (document.querySelector('#rHero h1') || {}).textContent || id,
      lead: ((document.querySelector('#rHero .lead') || document.querySelector('#rHero p:not(.kicker)')) || {}).textContent || '',
      packs: [...document.querySelectorAll('#packs .pack')].map(c => ({
        name: c.querySelector('h3').textContent.trim(),
        tag: (c.querySelector('.tag') || {}).textContent || '',
        meta: [...c.querySelectorAll('.pmeta span')].map(x => x.textContent.replace(/[⏱👥]/gu, '').trim()).join(', '),
        price: ((c.querySelector('.pr') || {}).innerText || '').split('\n').join(', ')
      }))
    }), id));
  }
  await b.close();

  const clean = t => t.replace(/[ ⁠]/g, ' ').replace(/\s+/g, ' ').trim();
  const num = t => { const m = clean(t).match(/(\d{1,3}(?: \d{3})+|\d+)/); return m ? +m[1].replace(/ /g, '') : null; };
  const allPrices = rooms.flatMap(r => r.packs.map(k => num(k.price))).filter(Boolean);

  const biz = {
    '@type': 'EntertainmentBusiness', '@id': BASE + '#business', name: 'Antistress Space',
    alternateName: ['Антистресс Спейс', 'Комната ярости Antistress Space'],
    description: 'Антистресс-комната (комната ярости, rage room), релакс-комната с фильмами и чаем, неоновое рисование мишек Glow Bear, PlayStation-комната и комбо-программы в Алматы. Дни рождения, корпоративы, свидания, девичники и мальчишники. Работаем с 2019 года, только по предварительной записи.',
    url: BASE, image: BASE + 'og.jpg', logo: BASE + 'img/logo.png',
    telephone: '+77760059959', email: 'antistress.space@gmail.com', foundingDate: '2019',
    address: { '@type': 'PostalAddress', streetAddress: 'ул. Байсеитовой, 49 (цокольный этаж, вход со двора)', addressLocality: 'Алматы', addressCountry: 'KZ' },
    areaServed: { '@type': 'City', name: 'Алматы' },
    hasMap: 'https://2gis.kz/almaty/firm/70000001067866712',
    priceRange: allPrices.length ? `${Math.min(...allPrices)}–${Math.max(...allPrices)} KZT` : undefined,
    currenciesAccepted: 'KZT',
    knowsAbout: ['комната ярости', 'антистресс-комната', 'rage room', 'релакс-комната', 'неоновое рисование', 'Glow Bear', 'PlayStation', 'необычный отдых в Алматы'],
    sameAs: ['https://www.instagram.com/antistress_space/', 'https://www.tiktok.com/@antistress_space', 'https://2gis.kz/almaty/firm/70000001067866712'],
    hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Комнаты и пакеты', itemListElement: rooms.map(r => ({
      '@type': 'OfferCatalog', name: clean(r.title), description: clean(r.lead),
      itemListElement: r.packs.map(k => { const pr = num(k.price), o = { '@type': 'Offer', name: clean(k.name), description: clean([k.tag, k.meta, k.price].filter(Boolean).join(' · ')), priceCurrency: 'KZT', url: BASE + '#/' + r.id };
        if (pr) o.priceSpecification = { '@type': 'PriceSpecification', minPrice: pr, priceCurrency: 'KZT' }; return o; })
    })) }
  };
  const faqLd = { '@type': 'FAQPage', '@id': BASE + '#faq', mainEntity: blocks.faq.map(f => ({ '@type': 'Question', name: clean(f.q), acceptedAnswer: { '@type': 'Answer', text: clean(f.a) } })) };
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': [biz, faqLd] }).replace(/</g, '\\u003c');

  const put = (s, id, html) => {
    const i = s.indexOf('id="' + id + '">'); if (i < 0) throw new Error('no ' + id);
    const a = s.indexOf('<!--prerender-->', i), z = s.indexOf('<!--/prerender-->', i);
    if (a < 0 || z < 0 || a > s.indexOf('</section>', i)) throw new Error('no markers in ' + id);
    return s.slice(0, a + 16) + html + s.slice(z);
  };
  src = put(src, 'heroRooms', blocks.heroRooms);
  src = put(src, 'preHome', blocks.preHome);
  src = put(src, 'faqList', blocks.faqList);
  src = src.replace(/<!--jsonld-->[\s\S]*?<!--\/jsonld-->/, '<!--jsonld--><script type="application/ld+json">' + ld + '</script><!--/jsonld-->');
  fs.writeFileSync(FILE, src);

  const L = [];
  L.push('# Antistress Space', '', '> Пространство для снятия стресса в Алматы: антистресс-комната (комната ярости, rage room), релакс-комната, неоновое рисование мишек Glow Bear, PlayStation-комната и комбо-программы. С 2019 года, рейтинг 5,0 в 2ГИС. Только по предварительной записи.', '');
  L.push('- Адрес: Алматы, ул. Байсеитовой, 49 — цокольный этаж, вход со двора, чёрная дверь', '- Телефон / WhatsApp: +7 776 005 9959', '- Email: antistress.space@gmail.com', '- Сайт и онлайн-запись: ' + BASE, '- Instagram: https://www.instagram.com/antistress_space/', '- 2ГИС: https://2gis.kz/almaty/firm/70000001067866712', '');
  L.push('## Форматы и цены', '');
  rooms.forEach(r => { L.push('### ' + clean(r.title), '', clean(r.lead), ''); r.packs.forEach(k => L.push('- ' + clean(k.name) + ' — ' + clean([k.price, k.meta, k.tag].filter(Boolean).join('; ')))); L.push(''); });
  L.push('## Особые поводы', '', 'Дни рождения (взрослые и детские), корпоративы и тимбилдинги, свидания, девичники и мальчишники, предложение руки и сердца, выездной антистресс на вашу площадку. Программу собирают под бюджет — заявка через сайт или WhatsApp.', '');
  L.push('## Подарочные сертификаты', '', 'Именной сертификат на пакет или сумму: электронный (500 ₸) или печатный в конверте с сургучной печатью (3 000 ₸). Действует 2 месяца.', '');
  L.push('## Перед визитом', ''); blocks.pre.forEach(x => L.push('- ' + clean(x))); L.push('');
  L.push('## Частые вопросы', ''); blocks.faq.forEach(f => L.push('**' + clean(f.q) + '** ' + clean(f.a), '')); 
  L.push('## Документы', '', '- Публичная оферта: ' + BASE + 'oferta.html', '- Политика конфиденциальности: ' + BASE + 'privacy.html', '');
  fs.writeFileSync(path.join(SITE, 'llms.txt'), L.join('\n'));
  console.log('rooms', rooms.map(r => r.id + ':' + r.packs.length).join(' '), '| faq', blocks.faq.length, '| price', biz.priceRange);
})();
