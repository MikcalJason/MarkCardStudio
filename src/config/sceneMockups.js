// Scene mockup templates place an already-rendered card onto a screen, a sheet
// of paper, a notebook page, or a printed poster inside a lifestyle photo.
// `quad` is stored in the scene photo's own normalized coordinates (0-1, origin
// top-left) so re-encoding the scene at a different size never invalidates the
// calibration. `cornerRadius` is the surface corner radius as a fraction of the
// surface width, masked in card space so the corners stay round after the
// perspective warp. `fit` describes how the card meets that surface:
// - `fill`: the quad is the device's panel, so the 3:4 card is painted across it
//   exactly and the projective warp supplies the foreshortening. Portrait pads
//   use this; their plate is 3:4 hardware, and it leaves no margin at all.
// - `contain`: keeps the whole card and continues the card's own edge colours
//   across the margin. Used where the surface really is another physical shape
//   (landscape monitors, laptops, sheets of paper).
// - `cover`: fills the quad and crops, for flat prints already close to 3:4.
// Every quad must hug the blank screen or sheet in the photo: the compositor can
// only paint the calibrated area, so a loose quad leaves a ring of the photo's
// blank plate around the card.
export const SCENE_MOCKUP_OUTPUT = { width: 1536, height: 2048 };

export const SCENE_CATEGORIES = [
  { id: "home", labelKey: "sceneMockup.categories.home" },
  { id: "study", labelKey: "sceneMockup.categories.study" },
  { id: "travel", labelKey: "sceneMockup.categories.travel" },
  { id: "lifestyle", labelKey: "sceneMockup.categories.lifestyle" },
  { id: "print", labelKey: "sceneMockup.categories.print" },
];

export const SCENE_MOCKUP_TEMPLATES = [
  // Home
  {
    id: "bedroom",
    category: "home",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.bedroom",
    image: "/mockups/bedroom.jpg",
    quad: {
      tl: [0.2595, 0.3195],
      tr: [0.6522, 0.3112],
      br: [0.7719, 0.6082],
      bl: [0.3817, 0.6786],
    },
    cornerRadius: 0.012,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 236, 210", opacity: 0.08 },
      dim: 0.01,
    },
  },
  {
    id: "breakfast",
    category: "home",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.breakfast",
    image: "/mockups/breakfast.jpg",
    quad: {
      tl: [0.4122, 0.3718],
      tr: [0.7985, 0.3794],
      br: [0.7276, 0.6674],
      bl: [0.3333, 0.6296],
    },
    cornerRadius: 0.011,
    lighting: {
      glare: 0.06,
      tint: { color: "255, 244, 225", opacity: 0.06 },
      dim: 0,
    },
  },
  {
    id: "livingroom",
    category: "home",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.livingroom",
    image: "/mockups/livingroom.jpg",
    quad: {
      tl: [0.3977, 0.3643],
      tr: [0.73, 0.3642],
      br: [0.6736, 0.7936],
      bl: [0.3402, 0.7605],
    },
    cornerRadius: 0.012,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 224, 185", opacity: 0.08 },
      dim: 0.02,
    },
  },
  {
    id: "kitchen",
    category: "home",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.kitchen",
    image: "/mockups/kitchen.jpg",
    quad: {
      tl: [0.3516, 0.3887],
      tr: [0.6875, 0.3926],
      br: [0.6536, 0.7832],
      bl: [0.3151, 0.7578],
    },
    cornerRadius: 0.055,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 240, 214", opacity: 0.08 },
      dim: 0.01,
    },
  },
  {
    id: "balcony",
    category: "home",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.balcony",
    image: "/mockups/balcony.jpg",
    quad: {
      tl: [0.3281, 0.3926],
      tr: [0.7135, 0.3848],
      br: [0.7578, 0.6777],
      bl: [0.3646, 0.7012],
    },
    cornerRadius: 0.06,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 245, 225", opacity: 0.05 },
      dim: 0,
    },
  },

  // Study and work
  {
    id: "desk",
    category: "study",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.desk",
    image: "/mockups/desk.jpg",
    quad: {
      tl: [0.3911, 0.2816],
      tr: [0.7847, 0.2832],
      br: [0.695, 0.7651],
      bl: [0.3031, 0.6998],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.07,
      tint: { color: "255, 214, 170", opacity: 0.1 },
      dim: 0.02,
    },
  },
  {
    id: "study",
    category: "study",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.study",
    image: "/mockups/study.jpg",
    quad: {
      tl: [0.3666, 0.4134],
      tr: [0.6736, 0.4082],
      br: [0.7648, 0.7222],
      bl: [0.4478, 0.7537],
    },
    cornerRadius: 0.04,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 230, 200", opacity: 0.08 },
      dim: 0.02,
    },
  },
  {
    id: "library",
    category: "study",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.library",
    image: "/mockups/library.jpg",
    quad: {
      tl: [0.3021, 0.3262],
      tr: [0.6172, 0.3418],
      br: [0.6953, 0.707],
      bl: [0.3672, 0.7285],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 240, 215", opacity: 0.07 },
      dim: 0.02,
    },
  },
  {
    id: "office",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.office",
    image: "/mockups/office.jpg",
    quad: {
      tl: [0.3049, 0.3311],
      tr: [0.8086, 0.3037],
      br: [0.7096, 0.6924],
      bl: [0.2214, 0.6396],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.03,
      tint: { color: "225, 238, 250", opacity: 0.04 },
      dim: 0,
    },
  },
  {
    id: "meeting",
    category: "study",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.meeting",
    image: "/mockups/meeting.jpg",
    quad: {
      tl: [0.3542, 0.2988],
      tr: [0.724, 0.2988],
      br: [0.6302, 0.7988],
      bl: [0.3073, 0.7109],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.04,
      tint: { color: "230, 240, 255", opacity: 0.05 },
      dim: 0.01,
    },
  },
  {
    id: "classroom",
    category: "study",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.classroom",
    image: "/mockups/classroom.jpg",
    quad: {
      tl: [0.2396, 0.293],
      tr: [0.8073, 0.2891],
      br: [0.7813, 0.6777],
      bl: [0.1927, 0.6465],
    },
    cornerRadius: 0.055,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 240, 220", opacity: 0.04 },
      dim: 0,
    },
  },
  {
    id: "dorm-desk",
    category: "study",
    surface: "laptop",
    fit: "contain",
    labelKey: "sceneMockup.templates.dormDesk",
    image: "/mockups/dorm-desk.jpg",
    quad: {
      tl: [0.2292, 0.3613],
      tr: [0.6615, 0.3789],
      br: [0.7292, 0.6328],
      bl: [0.2969, 0.6758],
    },
    cornerRadius: 0.02,
    lighting: {
      glare: 0.03,
      tint: { color: "255, 226, 196", opacity: 0.04 },
      dim: 0.02,
    },
  },
  {
    id: "teacher-desk",
    category: "study",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.teacherDesk",
    image: "/mockups/teacher-desk.jpg",
    quad: {
      tl: [0.4063, 0.3203],
      tr: [0.724, 0.3613],
      br: [0.6146, 0.6934],
      bl: [0.3099, 0.6016],
    },
    cornerRadius: 0.055,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 240, 220", opacity: 0.06 },
      dim: 0.01,
    },
  },
  {
    id: "laptop",
    category: "study",
    surface: "laptop",
    fit: "contain",
    labelKey: "sceneMockup.templates.laptop",
    image: "/mockups/laptop.jpg",
    quad: {
      tl: [0.3073, 0.3242],
      tr: [0.8594, 0.3379],
      br: [0.8151, 0.6445],
      bl: [0.263, 0.6113],
    },
    cornerRadius: 0.02,
    lighting: {
      glare: 0.04,
      tint: { color: "225, 238, 250", opacity: 0.03 },
      dim: 0.02,
    },
  },

  // Travel
  {
    id: "rail",
    category: "travel",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.rail",
    image: "/mockups/rail.jpg",
    quad: {
      tl: [0.4723, 0.451],
      tr: [0.8501, 0.4603],
      br: [0.7777, 0.7516],
      bl: [0.3962, 0.6799],
    },
    cornerRadius: 0.035,
    lighting: {
      glare: 0.04,
      tint: { color: "225, 238, 255", opacity: 0.06 },
      dim: 0.01,
    },
  },
  {
    id: "beach",
    category: "travel",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.beach",
    image: "/mockups/beach.jpg",
    quad: {
      tl: [0.2907, 0.2522],
      tr: [0.65, 0.2424],
      br: [0.7198, 0.6678],
      bl: [0.3555, 0.7066],
    },
    cornerRadius: 0.018,
    lighting: {
      glare: 0.07,
      tint: { color: "230, 245, 255", opacity: 0.06 },
      dim: 0,
    },
  },
  {
    id: "hotel",
    category: "travel",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.hotel",
    image: "/mockups/hotel.jpg",
    quad: {
      tl: [0.3359, 0.418],
      tr: [0.6927, 0.4043],
      br: [0.7526, 0.6563],
      bl: [0.388, 0.6973],
    },
    cornerRadius: 0.06,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 238, 215", opacity: 0.06 },
      dim: 0.02,
    },
  },
  {
    id: "airplane",
    category: "travel",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.airplane",
    image: "/mockups/airplane.jpg",
    quad: {
      tl: [0.3359, 0.2129],
      tr: [0.6641, 0.1973],
      br: [0.6901, 0.6211],
      bl: [0.3177, 0.6191],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.05,
      tint: { color: "220, 235, 255", opacity: 0.05 },
      dim: 0.02,
    },
  },

  // Everyday life and outdoors
  {
    id: "cafe",
    category: "lifestyle",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.cafe",
    image: "/mockups/cafe.jpg",
    quad: {
      tl: [0.3488, 0.308],
      tr: [0.7013, 0.3004],
      br: [0.6227, 0.7508],
      bl: [0.2639, 0.6992],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.08,
      tint: { color: "255, 198, 150", opacity: 0.12 },
      dim: 0.02,
    },
  },
  {
    id: "bookstore",
    category: "lifestyle",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.bookstore",
    image: "/mockups/bookstore.jpg",
    quad: {
      tl: [0.2682, 0.3027],
      tr: [0.6953, 0.2832],
      br: [0.8307, 0.7168],
      bl: [0.4036, 0.7734],
    },
    cornerRadius: 0.05,
    lighting: {
      glare: 0.04,
      tint: { color: "255, 230, 200", opacity: 0.06 },
      dim: 0.01,
    },
  },
  {
    id: "outdoor",
    category: "lifestyle",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.outdoor",
    image: "/mockups/outdoor.jpg",
    quad: {
      tl: [0.1735, 0.3836],
      tr: [0.6256, 0.3155],
      br: [0.752, 0.6307],
      bl: [0.3012, 0.7335],
    },
    cornerRadius: 0.03,
    lighting: {
      glare: 0.07,
      tint: { color: "255, 240, 210", opacity: 0.1 },
      dim: 0,
    },
  },
  {
    id: "camping",
    category: "lifestyle",
    surface: "screen",
    fit: "fill",
    labelKey: "sceneMockup.templates.camping",
    image: "/mockups/camping.jpg",
    quad: {
      tl: [0.2496, 0.278],
      tr: [0.6249, 0.2843],
      br: [0.7605, 0.7113],
      bl: [0.3651, 0.7537],
    },
    cornerRadius: 0.06,
    lighting: {
      glare: 0.05,
      tint: { color: "255, 236, 200", opacity: 0.08 },
      dim: 0,
    },
  },
  {
    id: "garden",
    category: "lifestyle",
    surface: "screen",
    fit: "contain",
    labelKey: "sceneMockup.templates.garden",
    image: "/mockups/garden.jpg",
    quad: {
      tl: [0.2786, 0.3047],
      tr: [0.776, 0.3281],
      br: [0.6875, 0.6895],
      bl: [0.1745, 0.6367],
    },
    cornerRadius: 0.06,
    lighting: {
      glare: 0.06,
      tint: { color: "255, 240, 210", opacity: 0.08 },
      dim: 0,
    },
  },

  // Printed paper, pages, and wall art
  {
    id: "print-desk",
    category: "print",
    surface: "paper",
    fit: "cover",
    labelKey: "sceneMockup.templates.printDesk",
    image: "/mockups/print-desk.jpg",
    quad: {
      tl: [0.2552, 0.2656],
      tr: [0.6979, 0.2383],
      br: [0.7865, 0.7559],
      bl: [0.2604, 0.7969],
    },
    cornerRadius: 0.004,
    lighting: null,
  },
  {
    id: "corkboard",
    category: "print",
    surface: "paper",
    fit: "contain",
    labelKey: "sceneMockup.templates.corkboard",
    image: "/mockups/corkboard.jpg",
    quad: {
      tl: [0.3021, 0.1719],
      tr: [0.7943, 0.1875],
      br: [0.8073, 0.8457],
      bl: [0.2448, 0.8516],
    },
    cornerRadius: 0.006,
    lighting: null,
  },
  {
    id: "poster-wall",
    category: "print",
    surface: "paper",
    // The sheet in this photo is far wider than 3:4, so cropping to fill it
    // would cut most of the card; the margin fill continues the paper instead.
    fit: "contain",
    labelKey: "sceneMockup.templates.posterWall",
    image: "/mockups/poster-wall.jpg",
    quad: {
      tl: [0.3125, 0.1816],
      tr: [0.6979, 0.2031],
      br: [0.6966, 0.5322],
      bl: [0.319, 0.5352],
    },
    cornerRadius: 0.003,
    lighting: null,
  },
  {
    id: "magazine",
    category: "print",
    surface: "paper",
    fit: "contain",
    labelKey: "sceneMockup.templates.magazine",
    image: "/mockups/magazine.jpg",
    quad: {
      tl: [0.5521, 0.2324],
      tr: [0.9401, 0.2266],
      br: [0.9479, 0.748],
      bl: [0.5599, 0.748],
    },
    cornerRadius: 0.006,
    lighting: null,
  },
  {
    id: "notebook",
    category: "print",
    surface: "paper",
    fit: "contain",
    labelKey: "sceneMockup.templates.notebook",
    image: "/mockups/notebook.jpg",
    quad: {
      tl: [0.5859, 0.3926],
      tr: [0.9167, 0.4902],
      br: [0.8333, 0.7734],
      bl: [0.5339, 0.7109],
    },
    cornerRadius: 0.014,
    lighting: null,
  },
  {
    id: "gallery",
    category: "print",
    surface: "paper",
    fit: "cover",
    labelKey: "sceneMockup.templates.gallery",
    image: "/mockups/gallery.jpg",
    quad: {
      tl: [0.3568, 0.3145],
      tr: [0.6875, 0.2949],
      br: [0.6875, 0.6348],
      bl: [0.3516, 0.6348],
    },
    cornerRadius: 0.002,
    lighting: null,
  },
];

export const SCENE_QUAD_POINTS = ["tl", "tr", "br", "bl"];

export function findSceneTemplate(id) {
  return SCENE_MOCKUP_TEMPLATES.find((template) => template.id === id) || null;
}

export function normalizeSceneId(value) {
  return findSceneTemplate(value) ? value : "";
}
