/**
 * Seed script: inserts ~400 Ukrainian-in-Europe Telegram groups into telegram_channels.
 * Run with: node --env-file-if-exists=/vercel/share/.env.project -r ts-node/register scripts/seed-channels.ts
 * Or trigger via POST /api/channels/seed (admin only).
 */

export const UA_EUROPE_CHANNELS = [
  // ── Українці в Європі (загальні) ─────────────────────────────────────
  { title: 'ua24be', link: 'https://t.me/ua24be', country: 'Belgium', city: '', category: 'Українці в Європі' },
  { title: 'Українці в Бельгії', link: 'https://t.me/belgiachat', country: 'Belgium', city: '', category: 'Українці в Європі' },
  { title: 'Ukraine in Antwerpen', link: 'https://t.me/Ukraine_in_Antwerpen', country: 'Belgium', city: 'Antwerpen', category: 'Українці в Європі' },
  { title: 'Українці в Нідерландах', link: 'https://t.me/dopomoganetherlands', country: 'Netherlands', city: '', category: 'Допомога / Підтримка' },
  { title: 'BIG Netherlands', link: 'https://t.me/BIG_Netherlands', country: 'Netherlands', city: '', category: 'Українці в Європі' },
  { title: 'Ukrainians in Amsterdam', link: 'https://t.me/ukrainiansinamsterdam', country: 'Netherlands', city: 'Amsterdam', category: 'Українці в Європі' },
  { title: 'Apeldoorn UA', link: 'https://t.me/apeldoorn_ua', country: 'Netherlands', city: 'Apeldoorn', category: 'Українці в Європі' },
  { title: 'UA in Leiden chat', link: 'https://t.me/ua_in_Leiden_chat', country: 'Netherlands', city: 'Leiden', category: 'Українці в Європі' },
  { title: 'Ukr DAM chat', link: 'https://t.me/ukrdamchat', country: 'Netherlands', city: 'Amsterdam', category: 'Українці в Європі' },

  // ── Франція ───────────────────────────────────────────────────────────
  { title: 'UA in FRANCE', link: 'https://t.me/UAinFRANCEE', country: 'France', city: '', category: 'Українці в Європі' },
  { title: 'Ukraine France Paris', link: 'https://t.me/ukrainefranceparis', country: 'France', city: 'Paris', category: 'Українці в Європі' },
  { title: 'Vstrechа Nice', link: 'https://t.me/vstrechaNicce', country: 'France', city: 'Nice', category: 'Українці в Європі' },
  { title: 'Dopomoga France', link: 'https://t.me/dopomogafrance', country: 'France', city: '', category: 'Допомога / Підтримка' },
  { title: 'France UA', link: 'https://t.me/france_ua1', country: 'France', city: '', category: 'Українці в Європі' },

  // ── Іспанія ───────────────────────────────────────────────────────────
  { title: 'Espana Ucrania', link: 'https://t.me/espana_ucrania', country: 'Spain', city: '', category: 'Українці в Європі' },

  // ── Угорщина ──────────────────────────────────────────────────────────
  { title: 'Hungary UA', link: 'https://t.me/hungary_ua', country: 'Hungary', city: '', category: 'Українці в Європі' },
  { title: 'Hungary UA 2', link: 'https://t.me/hungaryua', country: 'Hungary', city: '', category: 'Українці в Європі' },
  { title: 'HU Volunteers with UA', link: 'https://t.me/HUvolunteerswithUA', country: 'Hungary', city: '', category: 'Допомога / Підтримка' },

  // ── Австрія ───────────────────────────────────────────────────────────
  { title: 'Austria UA', link: 'https://t.me/austria_ua', country: 'Austria', city: '', category: 'Українці в Європі' },
  { title: 'Dopomoga Austria', link: 'https://t.me/dopomogaavstria', country: 'Austria', city: '', category: 'Допомога / Підтримка' },

  // ── Велика Британія ───────────────────────────────────────────────────
  { title: 'United Kingdom UA', link: 'https://t.me/unitedkingdomua', country: 'UK', city: '', category: 'Українці в Європі' },

  // ── Швеція ────────────────────────────────────────────────────────────
  { title: 'Refugees in Sweden', link: 'https://t.me/refugeesinSweden', country: 'Sweden', city: '', category: 'Українці в Європі' },

  // ── Польща ────────────────────────────────────────────────────────────
  { title: 'Ukrainians in Poland', link: 'https://t.me/Ukrainiann_in_Polandpl', country: 'Poland', city: '', category: 'Українці в Європі' },
  { title: 'UA in Warsaw', link: 'https://t.me/uainwarzsawa', country: 'Poland', city: 'Warsaw', category: 'Українці в Європі' },
  { title: 'Poland граница', link: 'https://t.me/poland_granitsa', country: 'Poland', city: '', category: 'Транспорт / Переїзд' },
  { title: 'Info Gdansk', link: 'https://t.me/info_Gdansk', country: 'Poland', city: 'Gdansk', category: 'Українці в Європі' },

  // ── Чехія ─────────────────────────────────────────────────────────────
  { title: 'Ukrainians Prague', link: 'https://t.me/Ukrainians_Prague', country: 'Czech Republic', city: 'Prague', category: 'Українці в Європі' },
  { title: 'Ukrainians in Prague 2', link: 'https://t.me/ukrainians_in_prague', country: 'Czech Republic', city: 'Prague', category: 'Українці в Європі' },
  { title: 'Ukraine CZ', link: 'https://t.me/ukraine_cz', country: 'Czech Republic', city: '', category: 'Українці в Європі' },
  { title: 'Ukrainci v Brno', link: 'https://t.me/ukrainavbrno', country: 'Czech Republic', city: 'Brno', category: 'Українці в Європі' },
  { title: 'Karlovy Vary chat', link: 'https://t.me/karlovy_vary_chat', country: 'Czech Republic', city: 'Karlovy Vary', category: 'Українці в Європі' },
  { title: 'Ustecky kraj', link: 'https://t.me/ustecky_kraj', country: 'Czech Republic', city: '', category: 'Українці в Європі' },
  { title: 'Plzensky kraj', link: 'https://t.me/Plzensky_kraj', country: 'Czech Republic', city: 'Plzen', category: 'Українці в Європі' },

  // ── Загальна Германія ─────────────────────────────────────────────────
  { title: 'Ukrainer in Deutschland', link: 'https://t.me/Ukrainer_in_Deutschland', country: 'Germany', city: '', category: 'Українці в Європі' },
  { title: 'UA in Deutschland', link: 'https://t.me/uaindeutschland', country: 'Germany', city: '', category: 'Українці в Європі' },
  { title: 'UA in DE', link: 'https://t.me/UAinDE', country: 'Germany', city: '', category: 'Українці в Європі' },
  { title: 'Deutschland UA', link: 'https://t.me/deutschland_ua1', country: 'Germany', city: '', category: 'Українці в Європі' },
  { title: 'Deutschland Help', link: 'https://t.me/deutschland_help', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'Ukrainians in NRW', link: 'https://t.me/ukrainiansinnrw', country: 'Germany', city: 'NRW', category: 'Українці в Європі' },
  { title: 'Ukrainians Rheinland Pfalz', link: 'https://t.me/ukrainians_rheinland_pfalz', country: 'Germany', city: 'Rheinland-Pfalz', category: 'Українці в Європі' },
  { title: 'Dopomoga Germany', link: 'https://t.me/dopomogagermania', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'Ru DE Help', link: 'https://t.me/ru_de_help', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'Help for Ukraine 22', link: 'https://t.me/helpforukraine22', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'La Ru Helps Ukraine', link: 'https://t.me/laruhelpsukraine', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'Робота в Германії 2023', link: 'https://t.me/RabotaGermany2023', country: 'Germany', city: '', category: 'Робота' },
  { title: 'Rabota uslugi Germania', link: 'https://t.me/rabota_uslugi_germania', country: 'Germany', city: '', category: 'Робота' },
  { title: 'Ukraine Germany Job', link: 'https://t.me/ukrainegermanyjob', country: 'Germany', city: '', category: 'Робота' },
  { title: 'Rebota for Ukrainian', link: 'https://t.me/rabotaforukrainian', country: 'Germany', city: '', category: 'Робота' },

  // ── Берлін ────────────────────────────────────────────────────────────
  { title: 'Ukrainians in Berlin', link: 'https://t.me/ukrainiansinberlin', country: 'Germany', city: 'Berlin', category: 'Українці в Європі' },
  { title: 'Ukraine Berlin Arrival Support', link: 'https://t.me/ukraineberlinarrivalsupport', country: 'Germany', city: 'Berlin', category: 'Допомога / Підтримка' },
  { title: 'Ukraine Help Berlin', link: 'https://t.me/ukrainehelpberlin', country: 'Germany', city: 'Berlin', category: 'Допомога / Підтримка' },
  { title: 'Barаholka Berlin', link: 'https://t.me/baraholkaberlin', country: 'Germany', city: 'Berlin', category: 'Барахолка' },
  { title: 'KaufBerlin', link: 'https://t.me/kaufberli', country: 'Germany', city: 'Berlin', category: 'Барахолка' },
  { title: 'Beauty Berlin UA', link: 'https://t.me/beauty_berlin_ua', country: 'Germany', city: 'Berlin', category: 'Б\'юті / Послуги' },
  { title: 'Berlin UA chat', link: 'https://t.me/berlin1111122', country: 'Germany', city: 'Berlin', category: 'Українці в Європі' },

  // ── Гамбург ───────────────────────────────────────────────────────────
  { title: 'Bei uns in Hamburg', link: 'https://t.me/beiunsinhamburg_chat', country: 'Germany', city: 'Hamburg', category: 'Українці в Європі' },
  { title: 'Hamburg hilft', link: 'https://t.me/hamburg_hilft', country: 'Germany', city: 'Hamburg', category: 'Допомога / Підтримка' },
  { title: 'Nash Hamburg', link: 'https://t.me/NashHamburg', country: 'Germany', city: 'Hamburg', category: 'Українці в Європі' },
  { title: 'Its Hamburg', link: 'https://t.me/itshamburg', country: 'Germany', city: 'Hamburg', category: 'Українці в Європі' },
  { title: 'Gamburg 4', link: 'https://t.me/gamburg4', country: 'Germany', city: 'Hamburg', category: 'Українці в Європі' },
  { title: 'Beauty Hamburg', link: 'https://t.me/HamburgBeauty', country: 'Germany', city: 'Hamburg', category: 'Б\'юті / Послуги' },
  { title: 'Second Hand HH', link: 'https://t.me/secondhand_hh', country: 'Germany', city: 'Hamburg', category: 'Барахолка' },

  // ── Мюнхен ────────────────────────────────────────────────────────────
  { title: 'Munich Dopomoga', link: 'https://t.me/munichdopomoga', country: 'Germany', city: 'Munich', category: 'Допомога / Підтримка' },
  { title: 'KH Munch', link: 'https://t.me/kh_munch', country: 'Germany', city: 'Munich', category: 'Українці в Європі' },
  { title: 'Munchen Ukraine', link: 'https://t.me/munchen_ukraine', country: 'Germany', city: 'Munich', category: 'Українці в Європі' },
  { title: 'Flohmark11 (München)', link: 'https://t.me/Flohmark11', country: 'Germany', city: 'Munich', category: 'Барахолка' },
  { title: 'Ukraine in Germany (München+)', link: 'https://t.me/ukraineingermany', country: 'Germany', city: 'Munich', category: 'Українці в Європі' },

  // ── Дюссельдорф ───────────────────────────────────────────────────────
  { title: 'Dusseldorf UA', link: 'https://t.me/dusseldorf_ua', country: 'Germany', city: 'Dusseldorf', category: 'Українці в Європі' },
  { title: 'UA Duesseldorf', link: 'https://t.me/UADuesseldorf', country: 'Germany', city: 'Dusseldorf', category: 'Українці в Європі' },
  { title: 'Dusseldorf Ukraine', link: 'https://t.me/dusseldorfukrain', country: 'Germany', city: 'Dusseldorf', category: 'Українці в Європі' },
  { title: 'Duesseldorf Girls', link: 'https://t.me/duesseldorf_girls', country: 'Germany', city: 'Dusseldorf', category: 'Українці в Європі' },
  { title: 'Beauty Dusseldorf', link: 'https://t.me/BeautyDusseldorf', country: 'Germany', city: 'Dusseldorf', category: 'Б\'юті / Послуги' },
  { title: 'Komissionka Dusseldorf', link: 'https://t.me/komissionkaDusseldorf', country: 'Germany', city: 'Dusseldorf', category: 'Барахолка' },
  { title: 'Tereveni HD', link: 'https://t.me/tereveni_hd', country: 'Germany', city: 'Dusseldorf', category: 'Українці в Європі' },

  // ── Кельн ─────────────────────────────────────────────────────────────
  { title: 'Keln UA', link: 'https://t.me/ua_koeln', country: 'Germany', city: 'Cologne', category: 'Українці в Європі' },
  { title: 'Keln3', link: 'https://t.me/keln3', country: 'Germany', city: 'Cologne', category: 'Українці в Європі' },
  { title: 'Ukrainian in Cologne', link: 'https://t.me/ukrainian_in_cologne', country: 'Germany', city: 'Cologne', category: 'Українці в Європі' },
  { title: 'UA Help Koeln Anzeigen', link: 'https://t.me/uahelpkoelnanzeigen', country: 'Germany', city: 'Cologne', category: 'Допомога / Підтримка' },
  { title: 'Beauty Koeln', link: 'https://t.me/beauty_koln', country: 'Germany', city: 'Cologne', category: 'Б\'юті / Послуги' },

  // ── Франкфурт ─────────────────────────────────────────────────────────
  { title: 'Ukrainci Frankfurt', link: 'https://t.me/ukraincifrankfurt', country: 'Germany', city: 'Frankfurt', category: 'Українці в Європі' },
  { title: 'Ukrainian in Frankfurt', link: 'https://t.me/ukrainian_in_frankfurt_am_main', country: 'Germany', city: 'Frankfurt', category: 'Українці в Європі' },
  { title: 'Helping Ukrainians Frankfurt', link: 'https://t.me/HelpingUkrainiansFrankfurtamMain', country: 'Germany', city: 'Frankfurt', category: 'Допомога / Підтримка' },
  { title: 'Koblenz ta navkolo', link: 'https://t.me/koblenz_ta_navkolo', country: 'Germany', city: 'Koblenz', category: 'Українці в Європі' },
  { title: 'Villingen Transport', link: 'https://t.me/Villingen_Transport', country: 'Germany', city: 'Villingen', category: 'Транспорт / Переїзд' },

  // ── Нюрнберг ──────────────────────────────────────────────────────────
  { title: 'Nurnberg Ukraine', link: 'https://t.me/nurnberg_ukraine', country: 'Germany', city: 'Nuremberg', category: 'Українці в Європі' },
  { title: 'Nyurnberg4', link: 'https://t.me/nyurnberg4', country: 'Germany', city: 'Nuremberg', category: 'Українці в Європі' },
  { title: 'Nuremberg Ukr', link: 'https://t.me/NurembergUkr', country: 'Germany', city: 'Nuremberg', category: 'Українці в Європі' },
  { title: 'Ukrainians in Nuremberg', link: 'https://t.me/Ukrainians_in_Nuremberg', country: 'Germany', city: 'Nuremberg', category: 'Українці в Європі' },
  { title: 'Nuremberg Ukraine Refugee Fun', link: 'https://t.me/NurembergUkraineRefugeeFun', country: 'Germany', city: 'Nuremberg', category: 'Українці в Європі' },
  { title: 'NASH NURNBERG INFO', link: 'https://t.me/NASH_NURNBERG_INFO', country: 'Germany', city: 'Nuremberg', category: 'Українці в Європі' },

  // ── Дортмунд ──────────────────────────────────────────────────────────
  { title: 'Ukraine Dortmund', link: 'https://t.me/ukraine_dortmund', country: 'Germany', city: 'Dortmund', category: 'Українці в Європі' },
  { title: 'Ukrainisch in Dortmund', link: 'https://t.me/ukrainischinDortmund', country: 'Germany', city: 'Dortmund', category: 'Українці в Європі' },

  // ── Дуйсбург ──────────────────────────────────────────────────────────
  { title: 'Duisburg Ukraine', link: 'https://t.me/duisburgukraine', country: 'Germany', city: 'Duisburg', category: 'Українці в Європі' },
  { title: 'Duysburg4', link: 'https://t.me/Duysburg4', country: 'Germany', city: 'Duisburg', category: 'Українці в Європі' },
  { title: 'Duisburg UA', link: 'https://t.me/DuisburgUA', country: 'Germany', city: 'Duisburg', category: 'Українці в Європі' },

  // ── Ессен ─────────────────────────────────────────────────────────────
  { title: 'Ukr DE Essen', link: 'https://t.me/ukr_de_essen', country: 'Germany', city: 'Essen', category: 'Українці в Європі' },
  { title: 'Dopomoga Ukrainzi Essen', link: 'https://t.me/dopomoga_ukrainzi_essen', country: 'Germany', city: 'Essen', category: 'Допомога / Підтримка' },
  { title: 'Komissionka Essen', link: 'https://t.me/komissionkaEssen', country: 'Germany', city: 'Essen', category: 'Барахолка' },
  { title: 'UA Help Ruhrgebiet', link: 'https://t.me/uahelp_ruhrgebiet', country: 'Germany', city: 'Ruhrgebiet', category: 'Допомога / Підтримка' },

  // ── Штутгарт ──────────────────────────────────────────────────────────
  { title: 'Baraholka Stuttgart', link: 'https://t.me/BaraholkaStuttgart', country: 'Germany', city: 'Stuttgart', category: 'Барахолка' },
  { title: 'UA Stuttgart', link: 'https://t.me/UaStuttgart', country: 'Germany', city: 'Stuttgart', category: 'Українці в Європі' },
  { title: 'Ukrainer in Esslingen', link: 'https://t.me/UkrainerinEsslingenamNeckar', country: 'Germany', city: 'Esslingen', category: 'Українці в Європі' },
  { title: 'Reutlingen Tubingen', link: 'https://t.me/ReutlingenTubingen', country: 'Germany', city: 'Reutlingen', category: 'Українці в Європі' },

  // ── Бремен ────────────────────────────────────────────────────────────
  { title: 'Bremen Baraholka', link: 'https://t.me/bremen_baraholka', country: 'Germany', city: 'Bremen', category: 'Барахолка' },
  { title: 'Bremen Life', link: 'https://t.me/bremenlife', country: 'Germany', city: 'Bremen', category: 'Українці в Європі' },
  { title: 'Bremen 4 Ukraine', link: 'https://t.me/bremen4ukraine', country: 'Germany', city: 'Bremen', category: 'Допомога / Підтримка' },
  { title: 'Solidarity Ukraine Bremen', link: 'https://t.me/SolidarityUkraineBremen', country: 'Germany', city: 'Bremen', category: 'Допомога / Підтримка' },
  { title: 'Support Ukraine in Bremen', link: 'https://t.me/suport_ukraine_in_bremen', country: 'Germany', city: 'Bremen', category: 'Допомога / Підтримка' },

  // ── Ганновер ──────────────────────────────────────────────────────────
  { title: 'Hannover Ukraine', link: 'https://t.me/HannoverUkrain', country: 'Germany', city: 'Hannover', category: 'Українці в Європі' },
  { title: 'Hannover Baraholka', link: 'https://t.me/hannover_baraholka', country: 'Germany', city: 'Hannover', category: 'Барахолка' },
  { title: 'Gannover4', link: 'https://t.me/Gannover4', country: 'Germany', city: 'Hannover', category: 'Українці в Європі' },
  { title: 'Hannover Information', link: 'https://t.me/hannoverinformation', country: 'Germany', city: 'Hannover', category: 'Українці в Європі' },

  // ── Дрезден ───────────────────────────────────────────────────────────
  { title: 'UA Dresden', link: 'https://t.me/ua_Dresden', country: 'Germany', city: 'Dresden', category: 'Українці в Європі' },
  { title: 'Beauty Dresden', link: 'https://t.me/BeautyDresden', country: 'Germany', city: 'Dresden', category: 'Б\'юті / Послуги' },
  { title: 'Ukraine in Dresden', link: 'https://t.me/ukraine_in_dresden', country: 'Germany', city: 'Dresden', category: 'Українці в Європі' },

  // ── Лейпциг ───────────────────────────────────────────────────────────
  { title: 'Leipzig Flohmarkt', link: 'https://t.me/Leipzig_Flohmarkt', country: 'Germany', city: 'Leipzig', category: 'Барахолка' },

  // ── Майнц / Рейнланд ──────────────────────────────────────────────────
  { title: 'Ukrainer Rheinland Pfalz', link: 'https://t.me/ukrainians_rheinland_pfalz', country: 'Germany', city: 'Mainz', category: 'Українці в Європі' },

  // ── Мюнстер ───────────────────────────────────────────────────────────
  { title: 'UA Munster', link: 'https://t.me/UA_Munster', country: 'Germany', city: 'Munster', category: 'Українці в Європі' },
  { title: 'Ukraine Muenster Support', link: 'https://t.me/muenster_ukraine_support', country: 'Germany', city: 'Munster', category: 'Допомога / Підтримка' },
  { title: 'Ukraine Muenster', link: 'https://t.me/ukrainemuensrer', country: 'Germany', city: 'Munster', category: 'Українці в Європі' },
  { title: 'Ukrainische Gemeinde Osnabrück', link: 'https://t.me/ukrainische_gemeinde_osnabrueck', country: 'Germany', city: 'Osnabrück', category: 'Українці в Європі' },

  // ── Аахен ─────────────────────────────────────────────────────────────
  { title: 'Kyda Poity Aachen', link: 'https://t.me/kyda_poity_Aachen', country: 'Germany', city: 'Aachen', category: 'Українці в Європі' },
  { title: 'Pomosh Ukraine Aachen', link: 'https://t.me/pomoshukraineaachen', country: 'Germany', city: 'Aachen', category: 'Допомога / Підтримка' },
  { title: 'Aachen Beauty', link: 'https://t.me/Aachen_beauty', country: 'Germany', city: 'Aachen', category: 'Б\'юті / Послуги' },

  // ── Бонн ──────────────────────────────────────────────────────────────
  { title: 'Bonn Help', link: 'https://t.me/bonn_help', country: 'Germany', city: 'Bonn', category: 'Допомога / Підтримка' },

  // ── Бохум ─────────────────────────────────────────────────────────────
  { title: 'Ukraine Bochum Support', link: 'https://t.me/ukraine_bochum_support', country: 'Germany', city: 'Bochum', category: 'Допомога / Підтримка' },

  // ── Росток ────────────────────────────────────────────────────────────
  { title: 'Rostock DUZ', link: 'https://t.me/RostockDUZ', country: 'Germany', city: 'Rostock', category: 'Українці в Європі' },
  { title: 'Rostok Price', link: 'https://t.me/rostok_price', country: 'Germany', city: 'Rostock', category: 'Барахолка' },
  { title: 'Rostock Support', link: 'https://t.me/Rostocksup', country: 'Germany', city: 'Rostock', category: 'Допомога / Підтримка' },
  { title: 'Beauty Mastera UA Rostok', link: 'https://t.me/beautimasteraUARostok', country: 'Germany', city: 'Rostock', category: 'Б\'юті / Послуги' },

  // ── Магдебург ─────────────────────────────────────────────────────────
  { title: 'Magdeburg Helps Ukraine', link: 'https://t.me/MagdeburghelpsUkraine', country: 'Germany', city: 'Magdeburg', category: 'Допомога / Підтримка' },
  { title: 'Magdeburg Ukrainian', link: 'https://t.me/Magdeburg_ukrainian', country: 'Germany', city: 'Magdeburg', category: 'Українці в Європі' },
  { title: 'MD meets UA', link: 'https://t.me/mdmeetsua', country: 'Germany', city: 'Magdeburg', category: 'Українці в Європі' },

  // ── Ерфурт ────────────────────────────────────────────────────────────
  { title: 'Erfurt DE', link: 'https://t.me/ErfurtDE', country: 'Germany', city: 'Erfurt', category: 'Українці в Європі' },
  { title: 'Erfurt UK', link: 'https://t.me/Erfurtuk', country: 'Germany', city: 'Erfurt', category: 'Українці в Європі' },
  { title: 'Erfurt UA', link: 'https://t.me/ErfurtUA', country: 'Germany', city: 'Erfurt', category: 'Українці в Європі' },

  // ── Кіль ─────────────────────────────────────────────────────────────
  { title: 'Ukrainian Hilfe Kiel', link: 'https://t.me/Ukrainian_Hilfe_Kiel', country: 'Germany', city: 'Kiel', category: 'Допомога / Підтримка' },
  { title: 'Kiel 4 Ukraine', link: 'https://t.me/kiel4ukraine', country: 'Germany', city: 'Kiel', category: 'Допомога / Підтримка' },

  // ── Аугсбург ──────────────────────────────────────────────────────────
  { title: 'OPG Augsburg', link: 'https://t.me/OPG_Augsburg', country: 'Germany', city: 'Augsburg', category: 'Українці в Європі' },

  // ── Нойміністер ───────────────────────────────────────────────────────
  { title: 'Neumuenster 4 Ukraine', link: 'https://t.me/neumuenster4ukraine', country: 'Germany', city: 'Neumuenster', category: 'Допомога / Підтримка' },

  // ── Потсдам ───────────────────────────────────────────────────────────
  { title: 'Ukraine 2022 Potsdam', link: 'https://t.me/Ukraine2022Potsdam', country: 'Germany', city: 'Potsdam', category: 'Допомога / Підтримка' },

  // ── Касель ────────────────────────────────────────────────────────────
  { title: 'Kassel Ukraine Hilfen', link: 'https://t.me/KasselUkrainehilfen', country: 'Germany', city: 'Kassel', category: 'Допомога / Підтримка' },

  // ── Ульм ──────────────────────────────────────────────────────────────
  { title: 'Gruppe Ukraine Ulm Neu Ulm', link: 'https://t.me/gruppe_ukraine_ulm_neu_ulm', country: 'Germany', city: 'Ulm', category: 'Українці в Європі' },
  { title: 'Ukrainische Pfadfinder Ulm', link: 'https://t.me/ukrainischepfadfinderulm', country: 'Germany', city: 'Ulm', category: 'Українці в Європі' },

  // ── Фрайбург ──────────────────────────────────────────────────────────
  { title: 'Chat Freiburg', link: 'https://t.me/chatFreiburg', country: 'Germany', city: 'Freiburg', category: 'Українці в Європі' },
  { title: 'HelpUkraine Konstanz', link: 'https://t.me/HelpUkraineKonstanz', country: 'Germany', city: 'Konstanz', category: 'Допомога / Підтримка' },

  // ── Інші міста Германії ───────────────────────────────────────────────
  { title: 'Solingen UA', link: 'https://t.me/solingen_UA', country: 'Germany', city: 'Solingen', category: 'Українці в Європі' },
  { title: 'Wuppertal UA', link: 'https://t.me/wuppertal_ua', country: 'Germany', city: 'Wuppertal', category: 'Українці в Європі' },
  { title: 'Women Wuppertal', link: 'https://t.me/womenwuppertal', country: 'Germany', city: 'Wuppertal', category: 'Українці в Європі' },
  { title: 'Krefeld Russki/UA', link: 'https://t.me/ruskrefeld', country: 'Germany', city: 'Krefeld', category: 'Українці в Європі' },
  { title: 'Mannheim UA Chat', link: 'https://t.me/mannheimUA_chat', country: 'Germany', city: 'Mannheim', category: 'Українці в Європі' },
  { title: 'Halle Arbeit', link: 'https://t.me/arbeit_Halle', country: 'Germany', city: 'Halle', category: 'Робота' },
  { title: 'Hilfe Hof Ukraine', link: 'https://t.me/hilfe_hof_ukraine2022', country: 'Germany', city: 'Hof', category: 'Допомога / Підтримка' },
  { title: 'HelpUkraine Hof', link: 'https://t.me/HelpUkraineHof', country: 'Germany', city: 'Hof', category: 'Допомога / Підтримка' },
  { title: 'HelpUkraine Eisenach', link: 'https://t.me/HelpUkraine_Eisenach', country: 'Germany', city: 'Eisenach', category: 'Допомога / Підтримка' },
  { title: 'Schwerin 4 Ukraine', link: 'https://t.me/schwerin4ukraine', country: 'Germany', city: 'Schwerin', category: 'Допомога / Підтримка' },
  { title: 'Chemnitz Wohnung Ukraine', link: 'https://t.me/wohnung_hilfe_chemnitz_ukraine', country: 'Germany', city: 'Chemnitz', category: 'Допомога / Підтримка' },
  { title: 'Ukrainer in Boeblengem', link: 'https://t.me/ukrainiansinboeblengengermany', country: 'Germany', city: 'Böblingen', category: 'Українці в Європі' },
  { title: 'Alsfeld Ukr', link: 'https://t.me/alsfeld_ukr', country: 'Germany', city: 'Alsfeld', category: 'Українці в Європі' },
  { title: 'Ukraine Goettingen', link: 'https://t.me/UkrainaGoettingen', country: 'Germany', city: 'Göttingen', category: 'Українці в Європі' },
  { title: 'Darmstadt Beauty', link: 'https://t.me/beauty_darmstadt', country: 'Germany', city: 'Darmstadt', category: 'Б\'юті / Послуги' },
  { title: 'Kempten Tereveni', link: 'https://t.me/Kempten_Tereveni', country: 'Germany', city: 'Kempten', category: 'Українці в Європі' },
  { title: 'Moenchengladbach Krasota', link: 'https://t.me/krasotamoenchengladbach', country: 'Germany', city: 'Mönchengladbach', category: 'Б\'юті / Послуги' },
  { title: 'Ukraine Dülmen', link: 'https://t.me/+u9VcbxuhKik1M2My', country: 'Germany', city: 'Dülmen', category: 'Українці в Європі' },
  { title: 'Ukr Help', link: 'https://t.me/ukrhelpp', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'Deutschland Help Language', link: 'https://t.me/de_language', country: 'Germany', city: '', category: 'Допомога / Підтримка' },
  { title: 'UA in EU (загальна)', link: 'https://t.me/ua_in_eu', country: 'Europe', city: '', category: 'Українці в Європі' },

  // ── Германія: NRW Продажа/Барахолка ──────────────────────────────────
  { title: 'Продажа NRW', link: 'https://t.me/prodajanrw', country: 'Germany', city: 'NRW', category: 'Барахолка' },
  { title: 'Baraholka Net 2024', link: 'https://t.me/barahlanet2024', country: 'Germany', city: 'NRW', category: 'Барахолка' },
  { title: 'Beauty NRW', link: 'https://t.me/BeautyNRW', country: 'Germany', city: 'NRW', category: 'Б\'юті / Послуги' },

  // ── Діджитал / Фріланс (Україна) ─────────────────────────────────────
  { title: 'Digital Topchik', link: 'https://t.me/digitaltopchik', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'IT Job UA', link: 'https://t.me/it_job_ua', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'IT Recruit UA', link: 'https://t.me/itrecruit_ua', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Recruiting UA', link: 'https://t.me/recruitingUA', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'HWorkNet Community', link: 'https://t.me/hworknet_community', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'PRO Design Chat', link: 'https://t.me/PRO_Design_chat_PSS', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Premium Job UA', link: 'https://t.me/premium_job_ua', country: 'Ukraine', city: '', category: 'Робота' },
  { title: 'Product Hunters', link: 'https://t.me/producthunters', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Rudenko Jobs', link: 'https://t.me/Rudenko_jobs', country: 'Ukraine', city: '', category: 'Робота' },
  { title: 'Rudenko SMM', link: 'https://t.me/RudenkoSMM', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Shopify Chat', link: 'https://t.me/shopify_chat', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'SMM Talking', link: 'https://t.me/smm_talking', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Strategium Club', link: 'https://t.me/strategiumclub', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Sales Hero Ads Chat', link: 'https://t.me/salesheroadschat', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Webflow Ukraine', link: 'https://t.me/webflow_ukraine', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Inflow Digital', link: 'https://t.me/inflow_digital', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'SMM Bunker', link: 'https://t.me/smmbunker', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Marketing Network', link: 'https://t.me/marketing_network1', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Marketing Jobs UA', link: 'https://t.me/marketing_jobs_ua', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Minist SMM', link: 'https://t.me/ministsmm', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Real Targetolog', link: 'https://t.me/real_targetolog', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Chat Targetologov', link: 'https://t.me/chat_targetologov', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'TikTok Target Chat', link: 'https://t.me/tiktoktarget_chat', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Gecko Des', link: 'https://t.me/geckodes', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Ukraine Digital', link: 'https://t.me/ukraine_digital', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Kyiv Digital Topchik', link: 'https://t.me/kyivdigitaltopchik', country: 'Ukraine', city: 'Kyiv', category: 'Діджитал / IT' },
  { title: 'IT Ukraine Business', link: 'https://t.me/itukrainebusiness', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Community FI', link: 'https://t.me/communityfi', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Spaceberry Community', link: 'https://t.me/spaceberry_community', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Saytology', link: 'https://t.me/saytology', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Design in UA', link: 'https://t.me/designinua', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Graphic Designer Chat', link: 'https://t.me/graphic_designerisss_chat', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Diloua', link: 'https://t.me/diloua', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Drop Chat', link: 'https://t.me/drop_chat', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Dropshipping UK', link: 'https://t.me/dropshiping_uk', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Tovarka Group', link: 'https://t.me/tovarka_group', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'UA Tovarka 4', link: 'https://t.me/ua_tovarka_4', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Tovarka Chat Business', link: 'https://t.me/tovarkachatbusines', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Etsy Biznes', link: 'https://t.me/EtsyBiznes', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Roznetka Sellers UA', link: 'https://t.me/rozetkasellersua', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Forbes Ukraine Comment', link: 'https://t.me/forbesukrainekoment', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'Grants 4 Business', link: 'https://t.me/grants4business', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'Azur Chat', link: 'https://t.me/azhurchat', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'Agro Chat Zerno', link: 'https://t.me/agrochat_zerno', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'Ukraine Agro', link: 'https://t.me/ukraina_agro', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'Chat Adminskiy', link: 'https://t.me/chat_adminskiy', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Diana Creo', link: 'https://t.me/dianacreo', country: 'Ukraine', city: '', category: 'Б\'юті / Послуги' },
  { title: 'NY Beauty', link: 'https://t.me/ny_beauty', country: 'Ukraine', city: '', category: 'Б\'юті / Послуги' },
  { title: 'Nail Masters Ukraine', link: 'https://t.me/nailsmaistersukraine', country: 'Ukraine', city: '', category: 'Б\'юті / Послуги' },
  { title: 'Stomatolog Chat', link: 'https://t.me/stomatolog_chat', country: 'Ukraine', city: '', category: 'Б\'юті / Послуги' },
  { title: 'Chat Buh', link: 'https://t.me/chatbuh', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'FLS Chat', link: 'https://t.me/flschat', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Smakuichat', link: 'https://t.me/smakuichat', country: 'Ukraine', city: '', category: 'Б\'юті / Послуги' },
  { title: 'HoReCa Family', link: 'https://t.me/HoReCaFamily', country: 'Ukraine', city: '', category: 'Бізнес / Фінанси' },
  { title: 'Roznetka Fashion Chat', link: 'https://t.me/rozetkafashionchat', country: 'Ukraine', city: '', category: 'Товари / Дропшиппінг' },
  { title: 'Theinstapreneurs Community', link: 'https://t.me/theinstapreneurscommunity', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
  { title: 'Miralis2', link: 'https://t.me/miralis2', country: 'Ukraine', city: '', category: 'Діджитал / IT' },
];

export function extractUsername(link: string): string {
  // handles https://t.me/username, https://t.me/+hash, https://t.me/channel/123
  const match = link.match(/t\.me\/([^/?\s]+)/);
  if (!match) return link;
  const part = match[1];
  if (part.startsWith('+')) return link; // invite link — keep full URL
  return part.split('/')[0]; // strip trailing /123
}
