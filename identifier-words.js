// Word dictionary for human-readable task identifiers (Color + Animal + City)
const colors = [
  'Red','Blue','Green','Gold','Silver','Amber','Azure','Black','White','Coral',
  'Crimson','Cyan','Emerald','Fuchsia','Gray','Indigo','Ivory','Jade','Lemon','Lilac',
  'Lime','Magenta','Maroon','Mint','Navy','Olive','Orange','Orchid','Peach','Pearl',
  'Pink','Plum','Purple','Rose','Ruby','Rust','Sage','Sand','Scarlet','Slate',
  'Snow','Steel','Teal','Topaz','Turquoise','Violet','Wine','Onyx','Cobalt','Honey',
  'Copper','Bronze','Saffron','Cerise','Mauve','Tan','Khaki','Charcoal','Cream','Blush'
];

const animals = [
  'Tiger','Eagle','Wolf','Bear','Falcon','Hawk','Lion','Shark','Whale','Cobra',
  'Panda','Fox','Otter','Raven','Lynx','Bison','Crane','Drake','Gecko','Heron',
  'Ibis','Jaguar','Koala','Lemur','Moose','Newt','Owl','Puma','Quail','Robin',
  'Seal','Toucan','Viper','Wren','Yak','Zebra','Parrot','Salmon','Mantis','Hornet',
  'Badger','Camel','Dingo','Ferret','Gorilla','Hyena','Iguana','Jackal','Kite','Lark',
  'Marten','Narwhal','Osprey','Pelican','Rhino','Stork','Turtle','Urchin','Vulture','Wombat'
];

const cities = [
  'Paris','Tokyo','Cairo','Milan','Seoul','Lima','Oslo','Rome','Baku','Doha',
  'Dublin','Kyoto','Lagos','Minsk','Nairobi','Perth','Quito','Riga','Sofia','Tunis',
  'Vienna','Warsaw','Zurich','Athens','Berlin','Bogota','Denver','Hanoi','Jakarta','Lisbon',
  'Madrid','Naples','Osaka','Prague','Salem','Taipei','Utrecht','Venice','Xiamen','Yangon',
  'Accra','Bern','Cork','Delhi','Fargo','Geneva','Havana','Izmir','Jeddah','Kigali',
  'Lyon','Mumbai','Nice','Odessa','Porto','Rabat','Sochi','Tirana','Ulan','Varna'
];

function generateIdentifier(existingIdentifiers) {
  const maxAttempts = 1000;
  for (let i = 0; i < maxAttempts; i++) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    const a = animals[Math.floor(Math.random() * animals.length)];
    const ci = cities[Math.floor(Math.random() * cities.length)];
    const id = c + a + ci;
    if (!existingIdentifiers.has(id)) return id;
  }
  // Fallback: append random number
  const c = colors[Math.floor(Math.random() * colors.length)];
  const a = animals[Math.floor(Math.random() * animals.length)];
  const ci = cities[Math.floor(Math.random() * cities.length)];
  return c + a + ci + Math.floor(Math.random() * 9999);
}

module.exports = { colors, animals, cities, generateIdentifier };
