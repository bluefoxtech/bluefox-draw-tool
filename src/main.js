import 'ol/ol.css';
import GeoJSON from 'ol/format/GeoJSON';
import Map from 'ol/Map';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import View from 'ol/View';
import sync from 'ol-hashed';
import Modify from 'ol/interaction/Modify';
import Draw from 'ol/interaction/Draw';
import Snap from 'ol/interaction/Snap';
import Select from 'ol/interaction/Select';
import { Fill, Stroke, Style, Text } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultControls, Attribution } from 'ol/control';
import { getArea, getLength } from 'ol/sphere';
import Overlay from 'ol/Overlay';
import "./main.css";

// Global variables
const drawnPolygons = [];

const attribution = new Attribution({
  collapsible: false,
});

// Map
const map = new Map({
  target: 'map-container',
  layers: [
    new VectorLayer({
      source: new VectorSource({
        format: new GeoJSON(),
        url: '/src/data/line.geojson',
        attributions: '© Crown copyright and database rights 2020 OS 100038864'
      })
    })
  ],
  controls: defaultControls({ attribution: false }).extend([attribution]),
  view: new View({
    center: fromLonLat([-3.82877, 53.28088]),
    zoom: 17.5
  })
});

// collapse the attribution infomation when screen < 600px
function checkSize() {
  const small = map.getSize()[0] < 600;
  attribution.setCollapsible(small);
  attribution.setCollapsed(small);
}

window.addEventListener('resize', checkSize);
checkSize();

// polygon data layer
const mapSource = new VectorSource({
  format: new GeoJSON(),
  url: './src/data/poly.geojson'
});

const mapLayer = new VectorLayer({
  source: mapSource
});

// draw layer
const drawingSource = new VectorSource();

const drawingLayer = new VectorLayer({
  source: drawingSource,
});

// add saved polygons from local storage as a map layer. Change vector source dynamically
const savedPolygonsSource = new VectorSource();
const savedPolygonsLayer = new VectorLayer({
  source: savedPolygonsSource,
});

// add additional layers to map layers to Map
map.addLayer(mapLayer);
map.addLayer(drawingLayer);
map.addLayer(savedPolygonsLayer);

// modify polygon interaction
const ModifyPolygon = {
  init: function () {
    this.select = new Select();
    map.addInteraction(this.select);

    this.modify = new Modify({
      features: this.select.getFeatures()
    });

    map.addInteraction(this.modify);

    // event listener that is fired when you've modified a feature
    this.modify.on('modifyend', function (e) {
      // update the area of polygon in feature's properties.
      const modifiedFeatures = e.features.array_;
      modifiedFeatures.forEach(feature => {
        const modifiedGeom = feature.values_.geometry;
        let modifiedOutput = formatArea(modifiedGeom)
        feature.set('polygon-area', modifiedOutput)
      });

      const modifyFeatureCoords = format.writeFeatures(e.features.array_);
      const modifyFeatureCoordsToObject = JSON.parse(modifyFeatureCoords);
      const drawnPolygonsFeatures = drawnPolygons[0].features;
      // loop through polygons in local storage by ID and replace old features with modified features
      for (let i = 0; i < drawnPolygonsFeatures.length; i++) {
        if (drawnPolygonsFeatures[i].id === modifyFeatureCoordsToObject.features[0].id) {
          drawnPolygonsFeatures[i] = modifyFeatureCoordsToObject.features[0];
          break;
        }
      }

      // store changes in local storage
      const modifiedFeaturesToString = JSON.stringify(drawnPolygons[0]);
      localStorage.setItem('polygon-features', modifiedFeaturesToString);
    });

    const getmodify = this.modify;
    this.setEvents();
  },
  setEvents: function () {
    const selectedFeatures = this.select.getFeatures();

    this.select.on('change:active', function () {
      selectedFeatures.forEach(function (each) {
        selectedFeatures.remove(each);
      });
    });
  },
  setActive: function (active) {
    this.select.setActive(active);
    this.modify.setActive(active);
  }
};
ModifyPolygon.init();

const optionsForm = document.getElementById('options-form');

// draw polygon interaction
const DrawPolygon = {
  init: function () {
    map.addInteraction(this.Polygon);
    this.Polygon.setActive(false);
  },
  Polygon: new Draw({
    source: drawingSource,
    type: 'Polygon'
  }),
  getActive: function () {
    return this.activeType ? this[this.activeType].getActive() : false;
  },
  setActive: function (active) {
    const type = optionsForm.elements['draw-type'].value;
    if (active) {
      this.activeType && this[this.activeType].setActive(false);
      this[type].setActive(true);
      this.activeType = type;
    } else {
      this.activeType && this[this.activeType].setActive(false);
      this.activeType = null;
    }
  }
};
DrawPolygon.init();

// DELETE FUNCTION
const DeletePolygon = {
  init: function () {
    this.deleteSelect = new Select({
      style: new Style({
        stroke: new Stroke({
          color: '#F89911',
          width: 2,
          lineDash: [5, 5]
        }),
        fill: new Fill({
          color: 'rgba(255, 255, 255, 0.3)'
        })
      })
    });
    map.addInteraction(this.deleteSelect);
    this.setEvents();


    // get features from the selected polygon
    this.deleteSelect.getFeatures().on('add', function (feature) {
      function checkDelete() {
        if (confirm("Are you sure you want to delete?")) {
          if (feature) {
            // try removing from drawingSource first
            try {
              drawingSource.removeFeature(feature.element);
              feature.target.remove(feature.element);
            }
            catch (err) {
            }
            // if feature isn't in drawingsource then try and remove it from savedPolygonsSource
            try {
              savedPolygonsSource.removeFeature(feature.element);
              feature.target.remove(feature.element);

              // find the polygon index position in drawnPolygons array and remove
              let position = drawnPolygons[0].features.findIndex(item => item.id === feature.element.id_);
              let deletedItems = drawnPolygons[0].features.splice(position, 1)

              // store updated drawnPolygons array in local storage
              const drawnPolygonsToString = JSON.stringify(drawnPolygons[0]);
              localStorage.setItem('polygon-features', drawnPolygonsToString)
            }
            catch (err) {
            }
          }
        } else {
          // do not want to delete then default to draw
          DrawPolygon.setActive(true);
          ModifyPolygon.setActive(false);
          DeletePolygon.setActive(false);
          document.getElementById("draw").checked = true;
        }
      }
      setTimeout(checkDelete, 500);
    });
  },
  setEvents: function () {
    const selectedDeleteFeatures = this.deleteSelect.getFeatures();

    this.deleteSelect.on('change:active', function () {
      selectedDeleteFeatures.forEach(function (each) {
        selectedDeleteFeatures.remove(each);
      });
    });
  },
  setActive: function (active) {
    this.deleteSelect.setActive(active);
  }
};
DeletePolygon.init();

// Let user change the function type.
optionsForm.onchange = function (e) {
  const type = e.target.getAttribute('name');
  const value = e.target.value;
  if (type == 'draw-type') {
    DrawPolygon.getActive() && DrawPolygon.setActive(true);
  } else if (type == 'interaction') {
    if (value == 'modify') {
      DrawPolygon.setActive(false);
      ModifyPolygon.setActive(true);
      DeletePolygon.setActive(false);
    } else if (value == 'draw') {
      DrawPolygon.setActive(true);
      ModifyPolygon.setActive(false);
      DeletePolygon.setActive(false);
    } else if (value == 'delete') {
      DeletePolygon.setActive(true);
      DrawPolygon.setActive(false);
      ModifyPolygon.setActive(false);
    }
  }
};

DrawPolygon.setActive(true);
ModifyPolygon.setActive(false);
DeletePolygon.setActive(false);

// drawn features snaps to map data
const snap = new Snap({
  source: mapSource
})
map.addInteraction(snap);

sync(map);

// format of map
const format = new GeoJSON({ featureProjection: 'EPSG:3857' });

/**
 * function to format area of polygon and convert to hectares
 */
const formatArea = function (polygon) {
  const area = getArea(polygon);
  let output = area / 10000
  output = (Math.round(output * 1000) / 1000) + ' ' + 'ha';
  return output;
};

/**
 * style function
 **/
function stylePolygon(feature) {
  return [
    new Style({
      stroke: new Stroke({
        color: 'red'
      }),
      fill: new Fill({
        color: 'rgba(255, 255, 255, 0.5)'
      }),
      text: new Text({
        font: 'bold 12px Arial, san-serif',
        fill: new Fill({
          color: 'black'
        }),
        // add polygon area as text
        text: feature.get('polygon-area'),
        textAlign: 'center'
      })
    })
  ]
}

/*
SAVE FEATURE TO LOCALSTORAGE
Polygons will persist if user closes/refreshes/opens new tab in browser
*/

// check if localStorage has an item
if (localStorage.getItem('polygon-features') === null) {
  // if there's nothing stored in localStorage and the drawnPolygons array is empty
  if (drawnPolygons.length === 0) {
    drawingSource.on('change', function (evt) {
      const features = drawingSource.getFeatures();

      // loop through features to add polygon area to feature's properties
      features.forEach(feature => {
        const geom = feature.values_.geometry;
        let output = formatArea(geom)
        feature.set('polygon-area', output)
      })

      // set the style of the drawing layer 
      drawingLayer.setStyle(stylePolygon)

      // convert json to object and add polygon-id
      const jsonFeatures = format.writeFeatures(features);
      const jsonFeaturesToObject = JSON.parse(jsonFeatures);
      const polygonFeatures = jsonFeaturesToObject.features;

      // add IDs generated by OL into polygonFeatures array
      const ids = [];
      for (let i = 0; i < features.length; i++) {
        ids.push(features[i].ol_uid);
        for (let j = 0; j < ids.length; j++) {
          polygonFeatures[j]['id'] = parseInt(ids[j]);
        }
      }

      // removes item from drawnPolygons array before pushing in modified feature
      if (drawnPolygons.length > 0) {
        drawnPolygons.pop();
      }
      drawnPolygons.push(jsonFeaturesToObject);

      // insert USER ID from JDi
      const userId = "jdi-id-random-id";

      // add user id to features drawn
      drawnPolygons[0]["user_id"] = userId;

      // add to local storage
      const jsonFeaturesToString = JSON.stringify(jsonFeaturesToObject);
      localStorage.setItem('polygon-features', jsonFeaturesToString);
    });
  }
} else {

  retrieveFeaturesFromLocalStorage();

  // polygons drawn after browser closed/refreshed
  drawingSource.on('change', function () {
    const features = drawingSource.getFeatures();

    // loop through features to add polygon area to feature's properties
    features.forEach(feature => {
      const geom = feature.values_.geometry;
      let output = formatArea(geom)
      feature.set('polygon-area', output)
    })

    // set the style of the drawing layer 
    drawingLayer.setStyle(stylePolygon)
    //  convert json to object
    const json = format.writeFeatures(features);
    const jsonToObject = JSON.parse(json);

    // extract "features" object
    const featuresObject = jsonToObject["features"];

    // add id to features object for each polygon
    const ids = [];

    for (let i = 0; i < features.length; i++) {
      ids.push(features[i].ol_uid);
      for (let j = 0; j < ids.length; j++) {
        featuresObject[j]['id'] = parseInt(ids[j]);
      }
    }

    // store in local storage
    const newPolygonsObjectToString = JSON.stringify(jsonToObject);
    localStorage.setItem('new-polygon-features', newPolygonsObjectToString);
  });
}

/*
function to retrieve features from local storage
*/
function retrieveFeaturesFromLocalStorage() {
  // If there are features stored in Local Storage('polygon-features') then
  // retrieve polygon coords from local storage, convert to object
  const retrieveLocalStorage = localStorage.getItem('polygon-features');
  const convertLocalStorageToObject = JSON.parse(retrieveLocalStorage);

  // push local storage to drawn polygons array
  drawnPolygons.push(convertLocalStorageToObject);

  // if you've refreshed and drawn additional features, then retrieve old features from Local Storage 
  if (localStorage.getItem('new-polygon-features') !== null) {
    const retrieveLocalStorageNewPolygons = localStorage.getItem('new-polygon-features');
    const convertNewPolygonsToObject = JSON.parse(retrieveLocalStorageNewPolygons);
    const newPolygonsfeaturesObject = convertNewPolygonsToObject["features"];

    // loop and push new features to drawnPolygons array 
    newPolygonsfeaturesObject.forEach(item => {
      drawnPolygons[0]["features"].push(item);
    });

    // stores the all polygons together under 'polygon-features'
    const stringifyNewPolygons = JSON.stringify(drawnPolygons[0])
    localStorage.setItem('polygon-features', stringifyNewPolygons);

    //clear new-polygon-features key in local storage 
    localStorage.removeItem('new-polygon-features');
  }

  // change the saved polygons source to features in local storage
  savedPolygonsLayer.getSource().addFeatures(format.readFeatures(convertLocalStorageToObject));

  // set the style of the drawing layer 
  savedPolygonsLayer.setStyle(stylePolygon)

  // takes object out of drawnPolygons array 
  const drawnPolygonsFromArrayToObject = drawnPolygons.pop();

  // pushes the object back into the drawnPolygons array
  drawnPolygons.push(drawnPolygonsFromArrayToObject);
}

/*
SUBMIT BUTTON
*/
const submitButton = document.getElementById('submit-drawing');
submitButton.addEventListener('click', function () {
  if (drawnPolygons.length === 0) {
    alert("You cannot submit an empty drawing.");
  } else if (drawnPolygons[0].features.length === 0 && drawnPolygons.length === 1) {
    alert("You cannot submit an empty drawing.");
  } else {
    if (confirm("Are you sure you want to submit?")) {
      if (localStorage.getItem('new-polygon-features') !== null) {
        retrieveFeaturesFromLocalStorage();
      }

      const saveLocalStorageToDatabase = JSON.parse(localStorage.getItem('polygon-features'));
      console.log('local storage', saveLocalStorageToDatabase);

      // NEED TO COMPLETE - save to database then clear local storage
    }
  }
});

/*
CLEAR ALL BUTTON
*/
const clear = document.getElementById('clear');
clear.addEventListener('click', function () {
  if (window.confirm("Are you sure you want to delete your drawing(s)?")) {
    drawingSource.clear();
    savedPolygonsSource.clear();
    localStorage.clear();
    window.location.reload();
  }
});

/*
LOAD DRAFT BUTTON
*/
const postmanServerUrlGet = "https://37e794d2-e93e-49c9-876f-6abcac26fbd3.mock.pstmn.io/database";

const loadDraft = document.getElementById('load-draft');
loadDraft.addEventListener('click', (e) => {
  let h = new Headers();

  // request options 
  let options = {
    method: 'GET',
    headers: h,
    mode: 'cors',
    cache: 'default'
  }

  let req = new Request(postmanServerUrlGet, options);

  fetch(req)
    .then(response => {
      return response.text();
    })
    .then(data => {
      console.log(data)
      let output = data;
      localStorage.setItem('polygon-features', output);
      setTimeout(() => location.reload(), 500);
    })
    .catch(err => {
      console.log(err)
    })
});

/*
SAVE DRAFT BUTTON
*/
const saveDraftButton = document.getElementById('save-draft');
saveDraftButton.addEventListener('click', function () {
  if (drawnPolygons.length === 0) {
    alert("You cannot save an empty drawing.");
  } else if (drawnPolygons[0].features.length === 0 && drawnPolygons.length === 1) {
    alert("You cannot save an empty drawing.");
  } else {
    if (confirm("Are you sure you want to save?")) {
      if (localStorage.getItem('new-polygon-features') !== null) {
        retrieveFeaturesFromLocalStorage();
      }

      const saveDraftToLocalStorageToDatabase = JSON.parse(localStorage.getItem('polygon-features'));
      console.log('local storage save draft', saveDraftToLocalStorageToDatabase);

      // NEED TO COMPLETE - save to database then clear local storage
    }
  }
});

/*
Measuring function
*/