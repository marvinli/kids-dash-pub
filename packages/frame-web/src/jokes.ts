/**
 * Dad jokes, kid-sized: a setup to read out, a punchline behind a tap. Built
 * into the page (the frame has no network), told in one fixed shuffled order,
 * round and round, so none repeats until all have been told. Keep them short (they show in big type)
 * and kind: no jokes about people.
 */
export interface Joke {
  setup: string;
  punchline: string;
}

export const JOKES: readonly Joke[] = [
  { setup: "Why did the cookie go to the doctor?", punchline: "Because it felt crummy!" },
  { setup: "What do you call a sleeping dinosaur?", punchline: "A dino-snore!" },
  { setup: "Why can't you trust stairs?", punchline: "They're always up to something!" },
  { setup: "What did the ocean say to the beach?", punchline: "Nothing. It just waved!" },
  { setup: "Why did the scarecrow win an award?", punchline: "He was outstanding in his field!" },
  { setup: "What do you call a bear with no teeth?", punchline: "A gummy bear!" },
  { setup: "Why don't eggs tell jokes?", punchline: "They'd crack each other up!" },
  { setup: "What has ears but cannot hear?", punchline: "A cornfield!" },
  { setup: "Why did the banana go to the doctor?", punchline: "It wasn't peeling well!" },
  { setup: "What do you call a fish with no eyes?", punchline: "A fsh!" },
  { setup: "Why was the math book sad?", punchline: "It had too many problems!" },
  { setup: "What do you call cheese that isn't yours?", punchline: "Nacho cheese!" },
  { setup: "How does a penguin build its house?", punchline: "Igloos it together!" },
  { setup: "What do you call a pig that knows karate?", punchline: "A pork chop!" },
  { setup: "Why did the bicycle fall over?", punchline: "It was two-tired!" },
  { setup: "What do cows read in the morning?", punchline: "The moos-paper!" },
  { setup: "Why do bees have sticky hair?", punchline: "They use honeycombs!" },
  { setup: "What did one wall say to the other wall?", punchline: "Meet you at the corner!" },
  { setup: "What do you call a dog magician?", punchline: "A labracadabrador!" },
  { setup: "Why did the teddy bear skip dessert?", punchline: "It was already stuffed!" },
  { setup: "What's a cat's favorite color?", punchline: "Purr-ple!" },
  { setup: "Why are fish so smart?", punchline: "They live in schools!" },
  { setup: "What do you call a snowman in July?", punchline: "A puddle!" },
  { setup: "How do you make an octopus laugh?", punchline: "With ten-tickles!" },
  {
    setup: "What did the left eye say to the right eye?",
    punchline: "Between you and me, something smells!",
  },
  { setup: "Why did the kid bring a ladder to school?", punchline: "To go to high school!" },
  { setup: "What kind of tree fits in your hand?", punchline: "A palm tree!" },
  { setup: "What do you call a sleeping bull?", punchline: "A bulldozer!" },
  { setup: "Why did the tomato turn red?", punchline: "It saw the salad dressing!" },
  { setup: "What do frogs order at restaurants?", punchline: "French flies!" },
  { setup: "What's orange and sounds like a parrot?", punchline: "A carrot!" },
  {
    setup: "Why did the golfer bring two pairs of pants?",
    punchline: "In case he got a hole in one!",
  },
  { setup: "What do you call a train full of bubble gum?", punchline: "A chew-chew train!" },
  { setup: "What do you get when you cross a snake and a pie?", punchline: "A pie-thon!" },
  { setup: "Why did the cow cross the road?", punchline: "To get to the udder side!" },
  { setup: "What did the big flower say to the little flower?", punchline: "Hi, bud!" },
  { setup: "Why can't a nose be 12 inches long?", punchline: "Then it would be a foot!" },
  { setup: "What do you call a dinosaur that's a noisy sleeper?", punchline: "A bronto-snorus!" },
  { setup: "How do you talk to a giant?", punchline: "Use big words!" },
  { setup: "What do you call a duck that gets all A's?", punchline: "A wise quacker!" },
  { setup: "Why did the music teacher need a ladder?", punchline: "To reach the high notes!" },
  { setup: "What do elves learn in school?", punchline: "The elf-abet!" },
  { setup: "Why did the picture go to jail?", punchline: "It was framed!" },
  { setup: "What do you call a lazy kangaroo?", punchline: "A pouch potato!" },
  { setup: "What gets wetter the more it dries?", punchline: "A towel!" },
  {
    setup: "Why did the owl invite friends over?",
    punchline: "It didn't want to be owl by itself!",
  },
  { setup: "What's a ghost's favorite dessert?", punchline: "I scream!" },
  { setup: "What do you call a boomerang that won't come back?", punchline: "A stick!" },
  {
    setup: "Why do seagulls fly over the sea?",
    punchline: "If they flew over the bay, they'd be bagels!",
  },
  { setup: "What did the zero say to the eight?", punchline: "Nice belt!" },
  { setup: "Why was the broom late?", punchline: "It over-swept!" },
  { setup: "What do you call a deer with no eyes?", punchline: "No idea!" },
  { setup: "What do you call an alligator in a vest?", punchline: "An in-vest-igator!" },
  { setup: "Why did the computer go to the doctor?", punchline: "It had a virus!" },
  { setup: "What do you call a cow that plays an instrument?", punchline: "A moo-sician!" },
  { setup: "Why did the chicken join a band?", punchline: "It had the drumsticks!" },
  { setup: "Why can't Elsa have a balloon?", punchline: "She'll let it go!" },
  { setup: "Where do polar bears keep their money?", punchline: "In a snow bank!" },
  { setup: "What do you call a polar bear in the desert?", punchline: "Lost!" },
  { setup: "What do seals like to watch?", punchline: "Sea-lebrity shows!" },
  { setup: "Why did the seal cross the ocean?", punchline: "To get to the other tide!" },
  { setup: "What do you call an axolotl that tells jokes?", punchline: "An axo-LOL-tl!" },
  { setup: "What's a capybara's favorite drink?", punchline: "Capy-chino!" },
  {
    setup: "What did the stamp say to the envelope?",
    punchline: "Stick with me and we'll go places!",
  },
  { setup: "Why do ducks have feathers?", punchline: "To cover their butt-quacks!" },
  { setup: "What do you call a bee that can't make up its mind?", punchline: "A maybe!" },
  { setup: "What did the dog say when it sat on sandpaper?", punchline: "Ruff!" },
  { setup: "Why did the cookie cry?", punchline: "Its mom was a wafer so long!" },
  { setup: "What do you call a hippo at the North Pole?", punchline: "A hippo-thermia!" },
  { setup: "Why are ghosts bad at lying?", punchline: "You can see right through them!" },
  { setup: "What did the tree say when spring came?", punchline: "What a re-leaf!" },
  { setup: "What do you call a rabbit that tells jokes?", punchline: "A funny bunny!" },
  {
    setup: "Why did the student eat his homework?",
    punchline: "The teacher said it was a piece of cake!",
  },
  { setup: "What has four wheels and flies?", punchline: "A garbage truck!" },
  { setup: "Why did the sun go to school?", punchline: "To get brighter!" },
  { setup: "What kind of shoes do frogs wear?", punchline: "Open-toad sandals!" },
  { setup: "What's a frog's favorite drink?", punchline: "Croak-a-cola!" },
  { setup: "Why do cows wear bells?", punchline: "Their horns don't work!" },
  { setup: "What do you call a fly without wings?", punchline: "A walk!" },
  { setup: "What did one plate say to the other?", punchline: "Lunch is on me!" },
  { setup: "Why don't skeletons fight each other?", punchline: "They don't have the guts!" },
  { setup: "What did the volcano say to its sweetheart?", punchline: "I lava you!" },
  { setup: "Why did the moon skip dinner?", punchline: "It was already full!" },
  { setup: "How do you organize a space party?", punchline: "You planet!" },
  { setup: "What do astronauts eat for lunch?", punchline: "Launch meat!" },
  { setup: "Why did the star go to school?", punchline: "To get a little brighter!" },
  { setup: "What kind of music do planets like?", punchline: "Nep-tunes!" },
  { setup: "What do you call a shoe made of a banana?", punchline: "A slipper!" },
  { setup: "Why did the orange stop rolling?", punchline: "It ran out of juice!" },
  { setup: "What did the lemon say to the sad lime?", punchline: "Squeeze the day!" },
  { setup: "What do you call a peanut in a spacesuit?", punchline: "An astro-nut!" },
  { setup: "Why did the potato cross the road?", punchline: "It saw a fork up ahead!" },
  { setup: "What do you call a sad strawberry?", punchline: "A blueberry!" },
  { setup: "Why did the pancake go to the party?", punchline: "To flip out!" },
  { setup: "What's a pirate's favorite letter?", punchline: "You'd think it's R, but it's the C!" },
  { setup: "Why couldn't the pirate play cards?", punchline: "He was sitting on the deck!" },
  { setup: "What did the shark say after eating a clownfish?", punchline: "This tastes funny!" },
  { setup: "Why did the crab never share?", punchline: "Because it was shellfish!" },
  { setup: "Why can't dinosaurs clap?", punchline: "They're extinct!" },
  { setup: "What do you call a T. rex that's been beaten?", punchline: "A Tyrannosaurus wrecked!" },
  {
    setup: "What do turkeys say at Thanksgiving?",
    punchline: "Gobble, gobble, please pass the gravy!",
  },
  { setup: "Why did the turkey cross the road?", punchline: "It was the chicken's day off!" },
  { setup: "What do snowmen eat for breakfast?", punchline: "Frosted Flakes!" },
  { setup: "What do you call a snowman with a six-pack?", punchline: "An abdominal snowman!" },
  { setup: "Why did the leaf go to the doctor?", punchline: "It was feeling green!" },
  { setup: "How do trees get online?", punchline: "They log in!" },
  { setup: "Why do birds fly south for winter?", punchline: "It's too far to walk!" },
  { setup: "What do you call a bird that's afraid to fly?", punchline: "A chicken!" },
  { setup: "What's a sheep's favorite game?", punchline: "Baa-dminton!" },
  { setup: "What do you call a horse that lives next door?", punchline: "A neigh-bor!" },
  { setup: "What do you call a pile of kittens?", punchline: "A meow-ntain!" },
  { setup: "Why did the cat sit on the computer?", punchline: "To keep an eye on the mouse!" },
  { setup: "What do you call a dog that can tell time?", punchline: "A watchdog!" },
  { setup: "Why did the puppy get a good grade?", punchline: "It was the teacher's pet!" },
  { setup: "How do bears keep their dens cool?", punchline: "Bear conditioning!" },
  {
    setup: "Why don't monkeys play cards in the jungle?",
    punchline: "There are too many cheetahs!",
  },
  {
    setup: "Why did the elephant paint its toenails red?",
    punchline: "To hide in the strawberry patch!",
  },
  { setup: "What's black and white and red all over?", punchline: "A zebra with a sunburn!" },
  { setup: "Why are penguins good race drivers?", punchline: "They always stay cool!" },
  { setup: "What do penguins wear on their heads?", punchline: "Ice caps!" },
  { setup: "Why did the spider go online?", punchline: "To check its website!" },
  { setup: "What do you call a snail on a ship?", punchline: "A snailor!" },
  { setup: "What do you call a worm in a fur coat?", punchline: "A caterpillar!" },
  { setup: "Why did the bee go to the barber?", punchline: "To get a buzz cut!" },
  { setup: "What did the pencil say to the paper?", punchline: "I dot my i's on you!" },
  { setup: "Why did the clock get sent to its room?", punchline: "It tocked back!" },
  { setup: "What has hands but can't clap?", punchline: "A clock!" },
  { setup: "What has a neck but no head?", punchline: "A bottle!" },
  { setup: "What has teeth but can't bite?", punchline: "A comb!" },
  { setup: "What goes up but never comes down?", punchline: "Your age!" },
  { setup: "What building has the most stories?", punchline: "The library!" },
  { setup: "Why did the book join the police?", punchline: "It wanted to go undercover!" },
  { setup: "Why was the belt arrested?", punchline: "It held up a pair of pants!" },
  { setup: "Why did the pizza maker go broke?", punchline: "He just couldn't make enough dough!" },
  { setup: "What did the sushi say to the bee?", punchline: "Wasabi!" },
  { setup: "Why did the soup go to art school?", punchline: "It wanted to be a broth-ist!" },
  { setup: "What did baby corn say to mama corn?", punchline: "Where's pop corn?" },
  { setup: "Why do mushrooms get invited to parties?", punchline: "They're fun-guys!" },
  { setup: "What do you call a train that sneezes?", punchline: "Achoo-choo train!" },
  { setup: "What did the traffic light say to the car?", punchline: "Don't look, I'm changing!" },
  {
    setup: "Why did the soccer ball quit the team?",
    punchline: "It was tired of being kicked around!",
  },
  { setup: "Why is a baseball stadium so cool?", punchline: "It's full of fans!" },
  { setup: "What do you call a sleeping drum?", punchline: "A snare-ing drum!" },
  { setup: "Why did the piano get locked out?", punchline: "It couldn't find the right keys!" },
  { setup: "Why did the robot go on vacation?", punchline: "To recharge its batteries!" },
  { setup: "What is a tornado's favorite game?", punchline: "Twister!" },
  {
    setup: "What did one raindrop say to the other?",
    punchline: "Two's company, three's a cloud!",
  },
  { setup: "How do you know the ocean is friendly?", punchline: "It waves!" },
  { setup: "What did the beach say when the tide came in?", punchline: "Long time, no sea!" },
  { setup: "Why did the toilet paper roll down the hill?", punchline: "To get to the bottom!" },
  { setup: "What's the best day to make your bed?", punchline: "Every day. Nice try!" },
];

/** A day's jokes: the joke of the day, then the bonus ones. */
export const JOKES_PER_DAY = 4;

/** The order the jokes are told in: shuffled once (seeded, so every frame agrees). */
const ORDER: readonly Joke[] = (() => {
  const order = [...JOKES];
  let seed = 20261118;
  const random = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as Joke, order[i] as Joke];
  }
  return order;
})();

/**
 * The jokes for `date` (YYYY-MM-DD), the same on every frame: the next
 * JOKES_PER_DAY in the order, day after day.
 */
export function jokesFor(date: string): Joke[] {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return Array.from(
    { length: JOKES_PER_DAY },
    (_, i) => ORDER[(day * JOKES_PER_DAY + i) % ORDER.length] as Joke,
  );
}
