/**
 * Section - A library for visualizing architectural assembly sections.
 * @type {Section|*|{}}
 * @param elementId Viewport DOM element ID
 * @param model Model definition
 * @param options Options
 */
var Section = function (elementId, model, options) {
    var instance = this;

    // TODO on init, make sure that nothing is selected

    instance.handlers = {}; // event handlers
    instance.model = model;
    instance.mouse = {x: 0, y: 0};
    instance.options = {
        background: 0xffffff,
        debug: false,
        defaultElement: {
            name: "element",
            constructionPlane: 90,                   // degrees around the X axis
            height: 500, // only relevant if the element is unitized, otherwise default to model dimension
            width: 500, // only relevant if the element is unitized, otherwise default to model dimension
            thickness: 10, // when -1, then fill the layer with the parent thickness?
            color: 0xcccccc,
            opacity: 1.0,
            material: null,
            transparency: 1.0,
            type: "sheet", // sheet, unit, frame
            offset: {top: 0, left: 0, bottom: 0, right: 0, front: 0, back: 0}
        },
        fps: 30,
        selectedMaterialColor: 0xffff00,
        selectedMaterialOpacity: 0.2,
        showOriginMarker: true
    };
    instance.raycaster = new THREE.Raycaster();
    instance.scene = null;
    instance.selected = null;
    instance.unselectedOpacity = 0.2;
    instance.viewport = document.getElementById(elementId);

    instance.height = instance.viewport.clientHeight;
    instance.width = instance.viewport.clientWidth;

    // override default options
    if (options) {
        Object.keys(options).forEach(function (key) {
            instance.options[key] = options[key];
        });
    }

    /**
     * Renders the scene and updates the render at the specified maximum frame
     * rate. This approach was taken because the renderer was doing excessive
     * work on the GPU, making it appear that the requestAnimationFrame was not
     * working.
     */
    this.animate = function () {
        setTimeout(function () {
            requestAnimationFrame(instance.animate);
            instance.select();
            instance.renderer.render(instance.scene, instance.camera);
            instance.controls.update();
        }, 1000 / instance.options.fps);
    };

    /**
     * Recursively apply default values to model.
     * @param model Model
     * @param defaults Model element default values
     */
    this.applyModelDefaults = function (model, defaults) {
        if (Array.isArray(model)) {
            model.forEach(function (element) {
                instance.applyModelDefaults(element, defaults);
            });
        } else {
            Object.keys(defaults).forEach(function(key) {
               if (!model.hasOwnProperty(key)) model[key] = defaults[key];
            });
        }
    };

    /**
     * Build the visualization by iteratively adding each assembly layer on top
     * of the next, starting at the construction plane and working in the
     * positive axis dimension.
     * @returns {THREE.Object3D}
     */
    this.build = function () {
        var group = new THREE.Object3D(), mesh, thickness = 0, totalThickness = 0;
        // apply default values to model properties that have not been specified
        instance.applyModelDefaults(instance.model, instance.options.defaultElement);
        // add each assembly layer to the
        instance.model.forEach(function (layer) {
            // determine the layer thickness
            if (Array.isArray(layer)) {
                // get the thickest element in the list
                thickness = layer.reduce(function (last, current) {
                    return (last < current.thickness) ? current.thickness : last;
                }, 0);
            } else {
                thickness = layer.thickness;
            }
            // if the thickness is 1mm or less, then set it to the minimum
            // allowed thickness
            thickness = (thickness < 5) ? 5 : thickness;
            // create the layer mesh
            mesh = instance.buildLayer(layer);
            mesh.position.set(0, 0, totalThickness + (thickness / 2));
            group.add(mesh);
            // update the total thickness
            totalThickness += thickness || 0;
        });
        // position the group at the center
        group.position.set(0, 0, 0);
        instance.scene.add(group);
    };

    /**
     * Build the layer representation.
     * @param layer Layer definition
     * @returns {THREE.Object3D}
     */
    this.buildLayer = function (layer) {
        var members = [], mesh;
        if (Array.isArray(layer)) {
            // generate mesh for each layer subassembly
            layer.forEach(function (subassembly) {
                members.push(instance.buildLayer(subassembly));
            });
            // boolean the subassemblies
            // TODO
            // clip the mesh to the boundary
            //var bounding_geometry = new THREE.BoxGeometry(instance.options.defaultElement.height, instance.options.defaultElement.width, obj.thickness);
            //var bounding_mesh = new THREE.Mesh(bounding_geometry);
            //var cube_bsp = new ThreeBSP(bounding_mesh);
            //var subtract_bsp = cube_bsp.subtract(sphere_bsp);
            //var result = subtract_bsp.toMesh( new THREE.MeshLambertMaterial({ shading: THREE.SmoothShading, map: THREE.ImageUtils.loadTexture('texture.png') }) );
            //result.geometry.computeVertexNormals();
            //scene.add(result);
            // group subassemblies
            mesh = new THREE.Object3D();
            members.forEach(function (member) {
                if (member) {
                    mesh.add(member);
                }
            });
        } else if (layer.type === 'unit') {
            mesh = instance.createUnitizedMesh(layer);
        } else if (layer.type === 'frame') {
            //mesh = instance.createFrameMesh(layer);
        } else if (layer.type === 'void') {
            mesh = new THREE.Object3D();
        } else {
            // sheet or infill material
            mesh = instance.createUnitMesh(
                layer.name,
                instance.options.defaultElement.width,
                instance.options.defaultElement.height,
                layer.thickness - layer.offset.front - layer.offset.back,
                layer.material
            );
            // TODO offset positioning
        }
        //// center the mesh in x and y
        //var helper = new THREE.BoundingBoxHelper(mesh);
        //try {
        //    helper.update();
        //    var x = (helper.box.max.x - helper.box.min.x) / 2;
        //    var y = (helper.box.max.y - helper.box.min.y) / 2;
        //    if (x === Infinity || x === -Infinity) {
        //        x = 0;
        //    }
        //    if (y === Infinity || y === -Infinity) {
        //        y = 0;
        //    }
        //    //mesh.position.set(x, y, 0);
        //} catch (e) {
        //    console.dir(e);
        //}
        return mesh;
    };

    /**
     * Create mesh for a sheet element.
     * @param obj Model object
     * @returns {THREE.Mesh}
     */
    this.createUnitizedMesh = function (obj) {
        var cols, geom = new THREE.Object3D(), i, j, rows, unit;
        // TODO there should be a configuration option for layout algorithm
        // lay the units out in an x, y grid
        rows = Math.ceil(instance.options.defaultElement.height / obj.height);
        cols = Math.ceil(instance.options.defaultElement.width / obj.width);
        if (instance.options.debug) console.log('cols %s rows %s', cols, rows);
        for (i = 0; i < rows; i++) {
            for (j = 0; j < cols; j++) {
                unit = instance.createUnitMesh(obj.name,
                    obj.width - obj.offset.left - obj.offset.right,
                    obj.height - obj.offset.top - obj.offset.bottom,
                    obj.thickness - obj.offset.front - obj.offset.back,
                    obj.material);
                unit.position.x = j * obj.width;
                unit.position.y = i * obj.height;
                geom.add(unit);
            }
        }
        // TODO merge the mesh into a single object
        // center the unit mesh
        geom.position.set(
            -(cols * obj.width / 2) + (obj.width * 0.5),
            -(rows * obj.height / 2) + (obj.height * 0.5),
            0);
        if (instance.options.debug) {
            var bbox = new THREE.BoundingBoxHelper(geom, 0xff0000);
            bbox.update();
            instance.scene.add(bbox);
        }
        return geom;
    };

    /**
     * Create unit mesh mesh.
     * @param name Model object name
     * @param width Width
     * @param height Height
     * @param thickness Thickness
     * @param material Material
     * @returns {THREE.Mesh}
     */
    this.createUnitMesh = function (name, width, height, thickness, material) {
        var geom, mat, mesh;
        geom = new THREE.BoxGeometry(width, height, thickness);
        mat = instance.getMaterial(material);
        mesh = new THREE.Mesh(geom, mat);
        mesh.name = name;
        return mesh;
    };

    /**
     * Deselect layers.
     * @param obj
     */
    this.deselect = function (obj) {
        if (obj.type === 'Mesh') {
            var tween = new TWEEN.Tween(obj.opacity).to(instance.options.unselectedOpacity, 1000);
        } else if (obj.type === 'Object3D') {
        }
    };

    /**
     * Get material.
     * @param material
     * @returns {*}
     */
    this.getMaterial = function (material) {
        var texture;
        if (material && material.texture) {
            try {
                texture = THREE.ImageUtils.loadTexture(material.texture);
                return new THREE.MeshBasicMaterial({map: texture, side: THREE.DoubleSide});
            } catch (e) {
                console.log("ERROR: Could not load material %s", material.texture);
            }
        }
        return new THREE.MeshLambertMaterial({
            color: material.color,
            transparent: true, // item.transparent || item.opacity < 1 ? true : false,
            opacity: material.opacity || 1.0
        });
    };

    this.init = function () {
        // Create the scene and set the scene size.
        instance.scene = new THREE.Scene();

        // Create a renderer and add it to the DOM.
        instance.renderer = new THREE.WebGLRenderer({antialias: true});
        instance.renderer.setSize(instance.width, instance.height);
        instance.viewport.appendChild(instance.renderer.domElement);

        // Set the background color of the scene.
        instance.renderer.setClearColor(instance.options.background, 1);

        // Resize the renderer when the browser window resizes
        window.addEventListener('resize', function () {
            instance.height = instance.viewport.clientHeight;
            instance.width = instance.viewport.clientWidth;
            instance.renderer.setSize(instance.width, instance.height);
            instance.camera.aspect = instance.width / instance.height;
            instance.camera.updateProjectionMatrix();
        });

        // Create a camera, zoom it out from the model a bit, and add it to the scene.
        instance.camera = new THREE.PerspectiveCamera(30, instance.width / instance.height, 0.1, 10000);
        instance.camera.lookAt(0, 0, 0);
        instance.camera.position.set(1000, 1000, 200);
        instance.scene.add(instance.camera);

        // Create a light, set its position, and add it to the scene.
        var light1 = new THREE.PointLight(0xaaaaaa);
        light1.position.set(-200, 300, -200);
        instance.scene.add(light1);

        var light2 = new THREE.PointLight(0xffffff);
        light2.position.set(200, 300, 200);
        instance.scene.add(light2);

        // origin marker
        if (instance.options.showOriginMarker) {
            var axisHelper = new THREE.AxisHelper(500);
            instance.scene.add(axisHelper);
        }

        // listen for mouse actions
        document.addEventListener('mousemove', instance.onMouseMove, false);

        // Zoom to fit the object bounding box
        // instance.zoomObject(camera, group);

        // Add OrbitControls so that we can pan around with the mouse.
        instance.controls = new THREE.OrbitControls(instance.camera, instance.renderer.domElement);
    };

    /**
     * Merge A then B into a new object C.
     * @param A The default object.
     * @param B The overriding object values.
     * @returns {{}}
     */
    this.merge = function (A, B) {
        var C = {};
        Object.keys(A).forEach(function (key) {
            C[key] = A[key];
        });
        Object.keys(B).forEach(function (key) {
            C[key] = B[key];
        });
        return C;
    };

    /**
     * Set an event handler.
     * @param event Event name
     * @param handler Event handler
     */
    this.on = function (event, handler) {
        if (!instance.handlers.hasOwnProperty(event)) {
            instance.handlers[event] = [];
        }
        instance.handlers[event].push(handler);
    };

    /**
     * Handle mouse move event.
     * @param event
     */
    this.onMouseMove = function (event) {
        event.preventDefault();
        instance.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        instance.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    /**
     * If the mouse pointer is over an object then set the opacity of all other
     * objects to a fraction of their current state.
     */
    this.select = function () {
        var vector = new THREE.Vector3(instance.mouse.x, instance.mouse.y, 1).unproject(instance.camera);
        var position = instance.camera.position;
        instance.raycaster.set(position, vector.sub(position).normalize());
        var intersects = instance.raycaster.intersectObjects(instance.scene.children, true);
        // if there is one (or more) intersections
        if (intersects.length > 0) {
            if (instance.options.debug) console.dir(intersects[0]);
            // if the closest object intersected is not the currently stored intersection object
            if (intersects[0].object != instance.selected) {
                // restore previous intersection object (if it exists) to its original color
                if (instance.selected)
                    instance.selected.material.color.setHex(instance.selected.currentHex);
                // store reference to closest object as current intersection object
                instance.selected = intersects[0].object;
                // store color of closest object (for later restoration)
                instance.selected.currentHex = instance.selected.material.color.getHex();
                // set a new color for closest object
                instance.selected.material.color.setHex(instance.options.selectedMaterialColor);
            }
        } else {
            // TODO set all object opacities to their default

            // restore previous intersection object (if it exists) to its original color
            if (instance.selected)
                instance.selected.material.color.setHex(instance.selected.currentHex);
            // remove previous intersection object reference
            //     by setting current intersection object to "nothing"
            instance.selected = null;
        }
    };

    /**
     * Stop animation.
     */
    this.stop = function () {
    };

    /**
     * Zoom the camera to fit the bounding box of the specified object within the
     * display.
     * @param obj Object3d
     */
    this.zoomObject = function (obj) {
        var correctForDepth = 1.3;
        var rotationSpeed = 0.01;
        var scale = 1;
        // create a bounding helper
        var helper = new THREE.BoundingBoxHelper(obj);
        helper.update();
        // get the bounding sphere
        var boundingSphere = helper.box.getBoundingSphere();
        // calculate the distance from the center of the sphere
        // and subtract the radius to get the real distance.
        var center = boundingSphere.center;
        var radius = boundingSphere.radius;
        var distance = center.distanceTo(instance.camera.position) - radius;
        var realHeight = Math.abs(helper.box.max.y - helper.box.min.y);
        var fov = 2 * Math.atan(realHeight * correctForDepth / (10 * distance)) * (180 / Math.PI);
        instance.camera.fov = fov;
        instance.camera.updateProjectionMatrix();
    };

    // setup
    this.init();

};
