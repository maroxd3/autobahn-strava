// Offline place lookup, used only to *suggest* a name for a newly created route.
//
// There is deliberately no network call here: reverse geocoding every trip would
// send location data to a third party, which is exactly what this app promises
// not to do. A bundled list of larger German towns is enough to turn a pair of
// coordinates into "Hannover → Celle". Coordinates are town centres, accurate to
// roughly a kilometre — fine for picking the nearest name, and the user can
// always rename the route afterwards.

(function (global) {
  "use strict";

  const PLACES = [
    ["Berlin", 52.52, 13.405], ["Hamburg", 53.551, 9.994], ["München", 48.135, 11.582],
    ["Köln", 50.938, 6.96], ["Frankfurt", 50.11, 8.682], ["Stuttgart", 48.775, 9.183],
    ["Düsseldorf", 51.227, 6.773], ["Leipzig", 51.34, 12.375], ["Dortmund", 51.514, 7.466],
    ["Essen", 51.456, 7.012], ["Bremen", 53.079, 8.802], ["Dresden", 51.05, 13.738],
    ["Hannover", 52.376, 9.732], ["Nürnberg", 49.452, 11.077], ["Duisburg", 51.435, 6.763],
    ["Bochum", 51.482, 7.216], ["Wuppertal", 51.256, 7.15], ["Bielefeld", 52.03, 8.533],
    ["Bonn", 50.737, 7.098], ["Münster", 51.96, 7.626], ["Karlsruhe", 49.007, 8.404],
    ["Mannheim", 49.487, 8.466], ["Augsburg", 48.371, 10.898], ["Wiesbaden", 50.083, 8.24],
    ["Mönchengladbach", 51.18, 6.442], ["Gelsenkirchen", 51.517, 7.086],
    ["Braunschweig", 52.269, 10.521], ["Kiel", 54.323, 10.135], ["Chemnitz", 50.828, 12.921],
    ["Aachen", 50.776, 6.084], ["Halle", 51.483, 11.97], ["Magdeburg", 52.121, 11.627],
    ["Freiburg", 47.999, 7.842], ["Krefeld", 51.334, 6.564], ["Lübeck", 53.866, 10.685],
    ["Oberhausen", 51.47, 6.852], ["Erfurt", 50.978, 11.029], ["Mainz", 49.993, 8.247],
    ["Rostock", 54.093, 12.131], ["Kassel", 51.312, 9.48], ["Hagen", 51.36, 7.472],
    ["Saarbrücken", 49.24, 6.997], ["Hamm", 51.68, 7.821], ["Potsdam", 52.391, 13.064],
    ["Ludwigshafen", 49.477, 8.445], ["Oldenburg", 53.144, 8.214], ["Leverkusen", 51.033, 6.985],
    ["Osnabrück", 52.279, 8.047], ["Solingen", 51.171, 7.084], ["Heidelberg", 49.399, 8.672],
    ["Herne", 51.538, 7.22], ["Neuss", 51.198, 6.694], ["Darmstadt", 49.872, 8.651],
    ["Paderborn", 51.719, 8.754], ["Regensburg", 49.014, 12.101], ["Ingolstadt", 48.766, 11.425],
    ["Würzburg", 49.792, 9.953], ["Fürth", 49.478, 10.99], ["Wolfsburg", 52.423, 10.787],
    ["Offenbach", 50.096, 8.776], ["Ulm", 48.401, 9.987], ["Heilbronn", 49.143, 9.211],
    ["Pforzheim", 48.891, 8.698], ["Göttingen", 51.542, 9.916], ["Bottrop", 51.524, 6.923],
    ["Trier", 49.75, 6.637], ["Recklinghausen", 51.614, 7.198], ["Reutlingen", 48.492, 9.204],
    ["Bremerhaven", 53.54, 8.58], ["Koblenz", 50.356, 7.594], ["Jena", 50.927, 11.586],
    ["Remscheid", 51.18, 7.19], ["Erlangen", 49.59, 11.004], ["Moers", 51.452, 6.626],
    ["Siegen", 50.874, 8.024], ["Hildesheim", 52.154, 9.958], ["Salzgitter", 52.157, 10.415],
    ["Celle", 52.623, 10.081], ["Lüneburg", 53.247, 10.414], ["Wolfenbüttel", 52.163, 10.537],
    ["Hameln", 52.104, 9.357], ["Soltau", 52.986, 9.843], ["Nienburg", 52.638, 9.213],
    ["Peine", 52.32, 10.233], ["Gifhorn", 52.488, 10.55], ["Uelzen", 52.966, 10.564],
    ["Stade", 53.596, 9.476], ["Verden", 52.923, 9.231], ["Minden", 52.289, 8.915],
    ["Herford", 52.115, 8.673], ["Detmold", 51.938, 8.878], ["Lingen", 52.522, 7.318],
    ["Emden", 53.367, 7.206], ["Wilhelmshaven", 53.529, 8.113], ["Cuxhaven", 53.859, 8.693],
    ["Flensburg", 54.782, 9.437], ["Neumünster", 54.072, 9.982], ["Schwerin", 53.636, 11.401],
    ["Cottbus", 51.757, 14.329], ["Zwickau", 50.718, 12.496], ["Gera", 50.88, 12.08],
    ["Bamberg", 49.892, 10.888], ["Bayreuth", 49.948, 11.578], ["Landshut", 48.537, 12.152],
    ["Rosenheim", 47.856, 12.128], ["Kempten", 47.727, 10.314], ["Konstanz", 47.663, 9.176],
    ["Tübingen", 48.52, 9.058], ["Esslingen", 48.74, 9.31], ["Sindelfingen", 48.708, 9.003],
    ["Aschaffenburg", 49.976, 9.148], ["Fulda", 50.555, 9.677], ["Gießen", 50.587, 8.679],
    ["Marburg", 50.809, 8.771], ["Limburg", 50.386, 8.065], ["Neubrandenburg", 53.558, 13.261],
  ];

  // Nearest town to a point, or null if nothing is within `maxKm`.
  function nearest(pt, maxKm) {
    maxKm = maxKm || 30;
    const H = global.Segments.haversine;
    let best = null;
    for (const [name, lat, lon] of PLACES) {
      const d = H(pt, { lat, lon });
      if (!best || d < best.d) best = { name, d };
    }
    return best && best.d <= maxKm * 1000 ? best.name : null;
  }

  // "Hannover → Celle", falling back to a generic label when a point is far from
  // every town we know about.
  function routeName(from, to) {
    const a = nearest(from);
    const b = nearest(to);
    if (a && b && a !== b) return `${a} → ${b}`;
    if (a && b && a === b) return `Rundfahrt ${a}`;
    if (a) return `Ab ${a}`;
    if (b) return `Nach ${b}`;
    return "Eigene Strecke";
  }

  global.Places = { nearest, routeName };
})(typeof window !== "undefined" ? window : globalThis);
