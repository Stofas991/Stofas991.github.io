/* ============================================================
   Reference klientu - JEDINY ZDROJ PRAVDY
   ------------------------------------------------------------
   Nacita se na dvou mistech:
     index.html      -> sekce "Reference" (#reference)
     case-study.html -> citace pod konkretni pripadovou studii

   Proto se citat NIKDY nepise primo do HTML zadne z tech stranek.
   Kdyby byl na dvou mistech, driv nebo pozdeji se opravi jen jeden
   a na webu budou dve ruzne verze toho, co klient rekl.

   `caseId` musi odpovidat klici v objektu `caseStudies`
   (case-study.html), jinak odkaz "Přečíst studii" nikam nevede.

   Text citace se pouziva doslova, vcetne velkych "Vaše"/"Vás" -
   je to prevzate zneni od klienta, ne nase formulace.
   ============================================================ */

const REFERENCES = [
  {
    caseId: 'wavyboats',
    text: 'Na naší spolupráci nám velmi vyhovovala rychlost zpracování požadovaných úprav našeho e-shopu. Veškerá Vaše práce splnila naše očekávání a potěšilo nás, že jsme si ve všem ihned porozuměli. Projekt nám vyřešil lepší přehlednost a průběh objednávek pro naše zákazníky. V případě dalších úprav se na Vás velmi rádi obrátíme.',
    author: 'Pavlína Pracnová',
    company: 'Wavy Boats',
    logo: { src: 'wavyboats_logo.webp', alt: 'Wavy Boats' }
  }
];
