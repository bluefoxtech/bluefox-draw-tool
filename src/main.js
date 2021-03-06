import "ol/ol.css";
import GeoJSON from "ol/format/GeoJSON";
import Map from "ol/Map";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import View from "ol/View";
import sync from "ol-hashed";
import Modify from "ol/interaction/Modify";
import Draw from "ol/interaction/Draw";
import Snap from "ol/interaction/Snap";
import Select from "ol/interaction/Select";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import { defaults as defaultControls, Attribution } from "ol/control";
import { getArea, getLength } from "ol/sphere";
import MultiPoint from "ol/geom/MultiPoint";
import "./main.css";
import "whatwg-fetch";
import proj4 from "proj4";
import TileWMS from "ol/source/TileWMS";
import TileLayer from "ol/layer/Tile";
import { register } from "ol/proj/proj4";
import { get as getProjection } from "ol/proj";

// Global variables
const drawnPolygons = [];

const attribution = new Attribution({
  collapsible: false,
});

// Projection EPSG: 27700
proj4.defs(
  "EPSG:27700",
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs"
);
register(proj4);

const britishNationalGridProjection = getProjection("EPSG:27700");

/**
 * MAP & LAYERS
 * */

const map = new Map({
  target: "map-container",
  layers: [
    new VectorLayer({
      source: new VectorSource({
        format: new GeoJSON(),
        url: "./src/data/line.geojson",
        attributions: "© Crown copyright and database rights 2020 OS 100038864",
      }),
    }),
  ],
  controls: defaultControls({ attribution: false }).extend([attribution]),
  view: new View({
    // center: fromLonLat([-3.82877, 53.28088]), // epsg:3857
    zoom: 18,
    center: [278100, 377500], // 27700
    projection: britishNationalGridProjection,
  }),
});

// collapse the attribution infomation when screen < 600px
function checkSize() {
  const small = map.getSize()[0] < 600;
  attribution.setCollapsible(small);
  attribution.setCollapsed(small);
}

window.addEventListener("resize", checkSize);
checkSize();

// polygon data layer
const mapSource = new VectorSource({
  format: new GeoJSON(),
  url: "./src/data/poly.geojson",
});

const mapLayer = new VectorLayer({
  source: mapSource,
});

//OpusMap WMS layer
const opusMapWms = new TileLayer({
  source: new TileWMS({
    urls: [
      "https://ts1.opus4.co.uk/wms",
      "https://ts2.opus4.co.uk/wms",
      "https://ts3.opus4.co.uk/wms",
    ],
    params: {
      LAYERS: "b:15",
      VERSION: "1.1.1",
      SRS: "EPSG:27700",
    },
  }),
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
map.addLayer(opusMapWms);
map.addLayer(mapLayer);
map.addLayer(drawingLayer);
map.addLayer(savedPolygonsLayer);

// projection of features when drawing
const format = new GeoJSON({ featureProjection: "EPSG:3857" });

/**
 * TOGGLE DRAW MODE
 **/
//modify polygon interaction
const ModifyPolygon = {
  init: function (e) {
    this.select = new Select({
      style: selectedPolygonStyles,
      layers: [drawingLayer, savedPolygonsLayer],
    });
    map.addInteraction(this.select);

    this.modify = new Modify({
      features: this.select.getFeatures(),
    });
    map.addInteraction(this.modify);

    // event listener that is fired when you've modified a feature
    this.modify.on("modifyend", function (e) {
      // update the area of polygon in feature's properties.
      const modifiedFeatures = e.features.array_;
      modifiedFeatures.forEach((feature) => {
        const modifiedGeom = feature.values_.geometry;
        let modifiedOutput = formatArea(modifiedGeom);
        feature.set("polygon-area", modifiedOutput);
      });
      const modifyFeatureCoords = format.writeFeatures(e.features.array_);
      const modifyFeatureCoordsToObject = JSON.parse(modifyFeatureCoords);
      const drawnPolygonsFeatures = drawnPolygons[0].features;

      // loop through polygons in local storage by ID and replace old features with modified features
      for (let i = 0; i < drawnPolygonsFeatures.length; i++) {
        if (
          drawnPolygonsFeatures[i].properties["polygon-id"] ===
          modifyFeatureCoordsToObject.features[0].properties["polygon-id"]
        ) {
          drawnPolygonsFeatures[i] = modifyFeatureCoordsToObject.features[0];
          break;
        }
      }

      // removes the modifypolygon interaction after modifying > see the area in hectares
      ModifyPolygon.setActive(false);

      // adds the interaction ready if further changes are needed
      ModifyPolygon.setActive(true);
      drawingLayer.setStyle(modifyPolygonStyles);

      // store changes in local storage
      const modifiedFeaturesToString = JSON.stringify(drawnPolygons[0]);
      let jdiId = getUrlId();
      localStorage.setItem(jdiId + "polygon-features", modifiedFeaturesToString);

      autoSaveFeatures();

    });

    this.setEvents();
  },
  setEvents: function () {
    const selectedFeatures = this.select.getFeatures();

    this.select.on("change:active", function () {
      selectedFeatures.forEach(function (each) {
        selectedFeatures.remove(each);
      });
    });
  },
  setActive: function (active) {
    this.select.setActive(active);
    this.modify.setActive(active);
  },
};
ModifyPolygon.init();

const optionsForm = document.getElementById("options-form");

// draw polygon interaction
const DrawPolygon = {
  init: function () {
    map.addInteraction(this.Polygon);
    this.Polygon.setActive(false);

    this.Polygon.on("drawend", function (e) {
      autoSaveFeatures();
    });
  },
  Polygon: new Draw({
    source: drawingSource,
    type: "Polygon",
  }),
  getActive: function () {
    return this.activeType ? this[this.activeType].getActive() : false;
  },
  setActive: function (active) {
    const type = optionsForm.elements["draw-type"].value;
    if (active) {
      this.activeType && this[this.activeType].setActive(false);
      this[type].setActive(true);
      this.activeType = type;
    } else {
      this.activeType && this[this.activeType].setActive(false);
      this.activeType = null;
    }
  },
};
DrawPolygon.init();

// DELETE FUNCTION
const DeletePolygon = {
  init: function () {
    this.deleteSelect = new Select({
      layers: [drawingLayer, savedPolygonsLayer],
      style: new Style({
        stroke: new Stroke({
          color: "#F89911",
          width: 2,
          lineDash: [5, 5],
        }),
        fill: new Fill({
          color: "rgba(255, 255, 255, 0.3)",
        }),
      }),
    });
    map.addInteraction(this.deleteSelect);
    this.setEvents();

    // get features from the selected polygon
    this.deleteSelect.getFeatures().on("add", function (feature) {
      function checkDelete() {
        if (confirm("Are you sure you want to delete?")) {
          if (feature) {
            // try removing from drawingSource first
            try {
              drawingSource.removeFeature(feature.element);
              feature.target.remove(feature.element);
            } catch (err) {}
            // if feature isn't in drawingsource then try and remove it from savedPolygonsSource
            try {
              savedPolygonsSource.removeFeature(feature.element);
              feature.target.remove(feature.element);
              // find the polygon index position in drawnPolygons array and remove
              let position = drawnPolygons[0].features.findIndex(
                (item) => item.properties['polygon-id'] === feature.element.values_['polygon-id']
              );
              let deletedItems = drawnPolygons[0].features.splice(position, 1);
              // store updated drawnPolygons array in local storage
              const drawnPolygonsToString = JSON.stringify(drawnPolygons[0]);
              let jdiId = getUrlId();
              localStorage.setItem(jdiId + "polygon-features", drawnPolygonsToString);
            } catch (err) {}

            autoSaveFeatures();
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

    this.deleteSelect.on("change:active", function () {
      selectedDeleteFeatures.forEach(function (each) {
        selectedDeleteFeatures.remove(each);
      });
    });
  },
  setActive: function (active) {
    this.deleteSelect.setActive(active);
  },
};
DeletePolygon.init();

// Let user change the function type.
optionsForm.onchange = function (e) {
  const type = e.target.getAttribute("name");
  const value = e.target.value;
  if (type == "draw-type") {
    DrawPolygon.getActive() && DrawPolygon.setActive(true);
  } else if (type == "interaction") {
    if (value == "modify") {
      DrawPolygon.setActive(false);
      ModifyPolygon.setActive(true);
      DeletePolygon.setActive(false);
      savedPolygonsLayer.setStyle(modifyPolygonStyles);
      drawingLayer.setStyle(modifyPolygonStyles);
    } else if (value == "draw") {
      DrawPolygon.setActive(true);
      ModifyPolygon.setActive(false);
      DeletePolygon.setActive(false);
      savedPolygonsLayer.setStyle(stylePolygon);
      drawingLayer.setStyle(stylePolygon);
    } else if (value == "delete") {
      DeletePolygon.setActive(true);
      DrawPolygon.setActive(false);
      ModifyPolygon.setActive(false);
      savedPolygonsLayer.setStyle(stylePolygon);
      drawingLayer.setStyle(stylePolygon);
    }
  }
};

DrawPolygon.setActive(true);
ModifyPolygon.setActive(false);
DeletePolygon.setActive(false);

// drawn features snaps to map data
const snap = new Snap({
  source: mapSource,
});
map.addInteraction(snap);

sync(map);

/** 
*AUTOSAVE FUNCTION
**/ 
function autoSaveFeatures() {
  setTimeout(() => {
    // save after each polygon is drawn
    let existingPolygonsInLocalStorage = [];
    let saveNewPolygonsToDatabase;
    let jdiId = getUrlId();

    if (localStorage.getItem(jdiId + "new-polygon-features") !== null) {
      // retrieve polygon coords from local storage, convert to object
      const getLocalStorage = localStorage.getItem(jdiId + "polygon-features");
      const convertLocalStorageToObject = JSON.parse(getLocalStorage);

      // push local storage to existingPolygonsInLocalStorage array
      existingPolygonsInLocalStorage.push(convertLocalStorageToObject);

      const getNewPolygons = localStorage.getItem(jdiId + "new-polygon-features");
      const convertNewPolygonsFromLocalStorageToObject = JSON.parse(
        getNewPolygons
      );

      const newPolygonsfeatures =
        convertNewPolygonsFromLocalStorageToObject["features"];

      // loop and push new features to newPolygonsFeatures array
      newPolygonsfeatures.forEach((item) => {
        existingPolygonsInLocalStorage[0]["features"].push(item);
      });
      saveNewPolygonsToDatabase = JSON.stringify(existingPolygonsInLocalStorage.pop());
    } else {
      let jdiId = getUrlId();
      saveNewPolygonsToDatabase = localStorage.getItem(jdiId + "polygon-features");
    }

    const opusUrl = "https://dev.opus4.co.uk/api/v1/call-for-sites/";

    let mapId = "1233/";

    let postDatabaseUrl = opusUrl + mapId + jdiId;

    let postOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: jdiId + "=" + saveNewPolygonsToDatabase,
    };

    fetch(postDatabaseUrl, postOptions)
      .then((response) => {
        if (response.status === 200) {
          console.log("SAVED");
        }
      })
      .catch((err) => {
        console.log(err);
      });
  }, 1000);
}

/**
 * function to format area of polygon and convert to hectares
 **/
const formatArea = function (polygon) {
  const area = getArea(polygon);
  let output = area / 10000;
  output =
    "Area = " + Math.round(output * 1000) / 1000 + " " + "\n" + "hectares";
  return output;
};

/**
 * Default style function
 **/
function stylePolygon(feature) {
  return [
    new Style({
      stroke: new Stroke({
        color: "red",
      }),
      fill: new Fill({
        color: "rgba(255, 255, 255, 0.5)",
      }),
      text: new Text({
        font: "bold 14px Arial, san-serif",
        textBaseline: "center",
        backgroundFill: new Fill({
          color: "#535353",
        }),
        fill: new Fill({
          color: "white",
        }),
        // add polygon area as text
        text: feature.get("polygon-area"),
        padding: [3, 2, 2, 2],
      }),
    }),
  ];
}

/**
 * Modify style function
 **/

function modifyPolygonStyles(feature) {
  return [
    new Style({
      stroke: new Stroke({
        color: "blue",
        width: 3,
      }),
      fill: new Fill({
        color: "rgba(255, 255, 255, 0.5)",
      }),
      text: new Text({
        font: "bold 14px Arial, san-serif",
        textBaseline: "center",
        backgroundFill: new Fill({
          color: "#535353",
        }),
        fill: new Fill({
          color: "white",
        }),
        // add polygon area as text
        text: feature.get("polygon-area"),
        padding: [3, 2, 2, 2],
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({
          color: "orange",
        }),
      }),
      geometry: function (feature) {
        // return the coordinates of the first ring of the polygon
        var coordinates = feature.getGeometry().getCoordinates()[0];
        return new MultiPoint(coordinates);
      },
    }),
  ];
}

/**
 * Select-modify style function
 **/

function selectedPolygonStyles(feature) {
  return [
    new Style({
      stroke: new Stroke({
        color: "blue",
        width: 3,
        lineDash: [5, 5],
      }),
      fill: new Fill({
        color: "rgba(255, 255, 255, 0.5)",
      }),
      text: new Text({
        font: "bold 14px Arial, san-serif",
        textBaseline: "center",
        backgroundFill: new Fill({
          color: "#535353",
        }),
        fill: new Fill({
          color: "white",
        }),
        text: feature.get("polygon-area"),
        padding: [3, 2, 2, 2],
      }),
    }),
    new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({
          color: "red",
        }),
      }),
      geometry: function (feature) {
        // return the coordinates of the first ring of the polygon
        var coordinates = feature.getGeometry().getCoordinates()[0];
        return new MultiPoint(coordinates);
      },
    }),
  ];
}

// set the style of the drawing layer
drawingLayer.setStyle(stylePolygon);

/*
Check if the database has a record for user
*/
// grab the siteid parameter from URL string
const getUrlId = () => {
  const url = window.location.href.toString();
  const regex = /siteid=(.*)/;
  const getId = url.match(regex);
  return getId[1];
};

function checkDatabase() {
  let jdiId = getUrlId();
  let retrievedFeaturesFromDatabase;
  let headerSettings = new Headers();

  // request options
  let options = {
    method: "GET",
    headers: headerSettings,
    mode: "cors",
    cache: "default"
  };

  const opusUrl = "https://dev.opus4.co.uk/api/v1/call-for-sites/";

  let mapId = "1233/";

  let getDatabaseUrl = opusUrl + mapId + jdiId;

  let req = new Request(getDatabaseUrl, options);

  fetch(req)
    .then(response => {
      if (response.status === 200) {
        return response.json();
      }
    })
    .then(data => {
      retrievedFeaturesFromDatabase = JSON.stringify(data);
      localStorage.setItem(jdiId + "polygon-features", retrievedFeaturesFromDatabase);
      setTimeout(() => location.reload(), 500);
    })
    .catch(err => {
      console.log("No record found in database");
    });
}

/*
SAVE FEATURE TO LOCALSTORAGE
Polygons will persist if user closes/refreshes/opens new tab in browser
*/

// check if localStorage has an item
let jdiId = getUrlId();

if (localStorage.getItem(jdiId + "polygon-features") === null) {
  //Check database to see if a record exists
  checkDatabase(); 
  // if there's nothing stored in localStorage and the drawnPolygons array is empty
  if (drawnPolygons.length === 0) {
    drawingSource.on("change", function () {
      const features = drawingSource.getFeatures();

      // loop through features to add polygon area to feature's properties
      features.forEach((feature) => {
        const geom = feature.values_.geometry;
        let output = formatArea(geom);
        feature.set("polygon-area", output);
      });

      // convert json to object and add polygon-id
      const jsonFeatures = format.writeFeatures(features);
      const jsonFeaturesToObject = JSON.parse(jsonFeatures);
      const polygonFeatures = jsonFeaturesToObject.features;

      // add IDs generated by OL into polygonFeatures array

      features.forEach((feature) => {
        const id = feature.ol_uid;
        feature.set("polygon-id", id);
      });

      // removes item from drawnPolygons array before pushing in modified feature
      if (drawnPolygons.length > 0) {
        drawnPolygons.pop();
      }
      drawnPolygons.push(jsonFeaturesToObject);

      // add to local storage
      const jsonFeaturesToString = JSON.stringify(jsonFeaturesToObject);
      localStorage.setItem(jdiId + "polygon-features", jsonFeaturesToString);
    });
  }
} else {
  retrieveFeaturesFromLocalStorage();
  // polygons drawn after browser closed/refreshed
  drawingSource.on("change", function () {
    const features = drawingSource.getFeatures();
    // loop through features to add polygon area to feature's properties
    features.forEach((feature) => {
      const geom = feature.values_.geometry;
      let output = formatArea(geom);
      feature.set("polygon-area", output);
    });

    //  convert json to object
    const featuresToObject = format.writeFeatures(features);

    // add id to features object for each polygon

    features.forEach((feature) => {
      const id = feature.ol_uid;
      feature.set("polygon-id", id);
    });
    // store in local storage
    localStorage.setItem(jdiId + "new-polygon-features", featuresToObject);
  });
}

/*
function to retrieve features from local storage
*/
function retrieveFeaturesFromLocalStorage() {
  // If there are features stored in Local Storage('polygon-features') then
  // retrieve polygon coords from local storage, convert to object
  let jdiId = getUrlId();
  const retrieveLocalStorage = localStorage.getItem(jdiId + "polygon-features");
  const convertLocalStorageToObject = JSON.parse(retrieveLocalStorage);

  // push local storage to drawn polygons array
  drawnPolygons.push(convertLocalStorageToObject);

  // if you've refreshed and drawn additional features, then retrieve old features from Local Storage
  if (localStorage.getItem(jdiId + "new-polygon-features") !== null) {
    const retrieveLocalStorageNewPolygons = localStorage.getItem(
      jdiId + "new-polygon-features"
    );
    const convertNewPolygonsToObject = JSON.parse(
      retrieveLocalStorageNewPolygons
    );
    const newPolygonsfeaturesObject = convertNewPolygonsToObject["features"];

    // loop and push new features to drawnPolygons array
    newPolygonsfeaturesObject.forEach((item) => {
      drawnPolygons[0]["features"].push(item);
    });

    // stores all polygons together under 'polygon-features'
    const stringifyNewPolygons = JSON.stringify(drawnPolygons[0]);
    localStorage.setItem(jdiId + "polygon-features", stringifyNewPolygons);

    //clear new-polygon-features key in local storage
    localStorage.removeItem(jdiId + "new-polygon-features");
  }

  // change the saved polygons source to features in local storage
  savedPolygonsLayer
    .getSource()
    .addFeatures(format.readFeatures(convertLocalStorageToObject));
    
  // set the style of the drawing layer
  savedPolygonsLayer.setStyle(stylePolygon);

  // takes object out of drawnPolygons array
  const drawnPolygonsFromArrayToObject = drawnPolygons.pop();

  // pushes the object back into the drawnPolygons array
  drawnPolygons.push(drawnPolygonsFromArrayToObject);
}

/*
SUBMIT BUTTON
*/
const submitButton = document.getElementById("submit-drawing");
submitButton.addEventListener("click", function () {
  if (drawnPolygons.length === 0 && 
    localStorage.getItem('new-polygon-features') === null
  ) {
    alert("You cannot submit an empty drawing.");
  } else if (
    drawnPolygons[0].features.length === 0 &&
    drawnPolygons.length === 1 && 
    localStorage.getItem('new-polygon-features') === null
  ) {
    alert("You cannot submit an empty drawing.");
  } else {
    if (confirm("Are you sure you want to submit?")) {
      if (localStorage.getItem("new-polygon-features") !== null) {
        retrieveFeaturesFromLocalStorage();
      }

      let jdiId = getUrlId();

      const saveLocalStorageToDatabase = localStorage.getItem(
        "polygon-features"
      );

      const opusUrl = "https://dev.opus4.co.uk/api/v1/call-for-sites/";

      let mapId = "1233/";

      let postDatabaseUrl = opusUrl + mapId + jdiId;

      let postOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: jdiId + "=" + saveLocalStorageToDatabase,
      };

      fetch(postDatabaseUrl, postOptions)
        .then((response) => {
          if (response.status === 200) {
            setTimeout(() => {
              alert("Thank you. Your drawing has now been submitted.");
              removePolygonsFromMap();
              localStorage.clear();
            }, 1000);
          } else {
            setTimeout(() => {
              alert("You cannot submit a drawing more than once.");
            }, 500);
          }
        })
        .catch((err) => {
          console.log(err);
        });
    }
  }
});

function removePolygonsFromMap() {
  const featuresFromDrawingLayer = drawingLayer.getSource().getFeatures();
  featuresFromDrawingLayer.forEach((feature) => {
    drawingLayer.getSource().removeFeature(feature);
  });

  const featuresFromSavedPolygonsLayer = savedPolygonsLayer.getSource().getFeatures();
  featuresFromSavedPolygonsLayer.forEach((feature) => {
    savedPolygonsLayer.getSource().removeFeature(feature);
  });
}

/*
CLEAR ALL BUTTON
*/
const clear = document.getElementById("clear");
clear.addEventListener("click", function () {
  if (window.confirm("Are you sure you want to delete your drawing(s)?")) {
    removePolygonsFromMap();
    localStorage.clear();
    setTimeout(() => {
      const emptyFeatureObject = {"type":"FeatureCollection","features":[]};
      const jdiId = getUrlId();

      const opusUrl = "https://dev.opus4.co.uk/api/v1/call-for-sites/";

      let mapId = "1233/";

      let postDatabaseUrl = opusUrl + mapId + jdiId;

      let postOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: jdiId + "=" + JSON.stringify(emptyFeatureObject)
      };

      fetch(postDatabaseUrl, postOptions)
        .then((response) => {
          if (response.status === 200) {
            console.log("DELETED");
          }
        })
        .catch((err) => {
          console.log(err);
        });
    }, 1000);
  }
});
