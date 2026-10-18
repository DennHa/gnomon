// A line from a Greek philosopher for the morning welcome (src/views/Morning.tsx). One per day, picked by the date,
// so it's the same all day and changes overnight. Only sayings the ancient sources actually give, in common
// translations; no internet quotes "attributed to" someone.
import { getLang } from './i18n';

type Quote = { en: string; de: string; by: string };

const QUOTES: Quote[] = [
  { by: 'Heraclitus', en: 'The sun is new each day.', de: 'Die Sonne ist neu an jedem Tag.' },
  { by: 'Aristotle', en: 'The beginning is half of the whole.', de: 'Der Anfang ist die Hälfte des Ganzen.' },
  { by: 'Plato', en: 'The beginning is the most important part of the work.', de: 'Der Anfang ist der wichtigste Teil der Arbeit.' },
  { by: 'Epictetus', en: 'First say to yourself what you would be; then do what you have to do.', de: 'Sag dir zuerst, wer du sein willst; dann tu, was du zu tun hast.' },
  { by: 'Epictetus', en: 'No great thing is created suddenly.', de: 'Nichts Großes entsteht plötzlich.' },
  { by: 'Epictetus', en: 'People are disturbed not by things, but by the views they take of them.', de: 'Nicht die Dinge beunruhigen die Menschen, sondern ihre Meinungen über die Dinge.' },
  { by: 'Heraclitus', en: 'Character is destiny.', de: 'Der Charakter ist des Menschen Schicksal.' },
  { by: 'Heraclitus', en: 'You cannot step into the same river twice.', de: 'Man kann nicht zweimal in denselben Fluss steigen.' },
  { by: 'Heraclitus', en: 'Everything flows.', de: 'Alles fließt.' },
  { by: 'Democritus', en: 'Happiness does not dwell in herds or in gold; the soul is the dwelling place of our fortune.', de: 'Glück wohnt nicht in Herden und nicht im Gold; die Seele ist der Wohnort unseres Geschicks.' },
  { by: 'Epicurus', en: 'Do not spoil what you have by desiring what you have not.', de: 'Verdirb dir nicht, was du hast, indem du dir wünschst, was du nicht hast.' },
  { by: 'Epicurus', en: 'Of all that wisdom provides for a happy life, by far the greatest is friendship.', de: 'Von allem, was die Weisheit für ein glückliches Leben bereitstellt, ist die Freundschaft bei Weitem das Größte.' },
  { by: 'Aristotle', en: 'What we have to learn to do, we learn by doing.', de: 'Was wir erst lernen müssen, um es zu tun, das lernen wir, indem wir es tun.' },
  { by: 'Aristotle', en: 'Pleasure in the work puts perfection in the work.', de: 'Freude an der Arbeit lässt das Werk trefflich werden.' },
  { by: 'Plato', en: 'Wonder is the beginning of philosophy.', de: 'Das Staunen ist der Anfang der Philosophie.' },
  { by: 'Zeno of Citium', en: 'Well-being is reached little by little, and yet it is no little thing.', de: 'Das Gelingen kommt Schritt für Schritt und ist doch keine Kleinigkeit.' },
  { by: 'Socrates', en: 'The unexamined life is not worth living.', de: 'Ein Leben ohne Prüfung ist nicht lebenswert.' },
  { by: 'Thales', en: 'Know yourself.', de: 'Erkenne dich selbst.' },
  { by: 'Heraclitus', en: 'Much learning does not teach understanding.', de: 'Vielwisserei lehrt nicht Verstand haben.' },
  { by: 'Epictetus', en: 'Make the best use of what is in your power, and take the rest as it happens.', de: 'Mach das Beste aus dem, was in deiner Macht steht, und nimm den Rest, wie er kommt.' },
];

/** The quote for a day ("YYYY-MM-DD"), in the app's language. */
export function quoteFor(day: string): { text: string; by: string } {
  const n = Math.floor(Date.parse(`${day}T12:00:00Z`) / 86_400_000);
  const q = QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length];
  const by = getLang() === 'de' ? { Aristotle: 'Aristoteles', Plato: 'Platon', Heraclitus: 'Heraklit', Epictetus: 'Epiktet', Democritus: 'Demokrit', Epicurus: 'Epikur', 'Zeno of Citium': 'Zenon von Kition', Socrates: 'Sokrates' }[q.by] ?? q.by : q.by;
  return { text: getLang() === 'de' ? q.de : q.en, by };
}
