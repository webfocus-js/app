/**
 * WebfocusApp module.
 * @module app
 */
const express = require('express');
const path = require('path');
const debugp = require('debug');
const debug = debugp('webfocus:app');
const warn = debugp('webfocus:app:warning');
warn.enabled = true;

/**
 * Object that defines default properties for the {@link WebfocusApp}
 */
const DEFAULT_VALUES = {
    port: 0,
    name: "Default Application Name",
    dirname: path.join(__dirname, 'views'),
    static: path.join(__dirname, 'static')
}

/**
 * Reserved names that cannot be used by a component
 */
const RESERVED_URLNAMES = [
    "bootstrap",
    "webfocus-static",
    "popperjs"
]

/**
 * Class that allows the registration of components ({@link WebfocusComponent}) and creates a server.
 * 
 * To start the sever call {@link WebfocusApp.start} the server will listen on the {@link WebfocusApp.configuration.port}.
 * 
 * The default values for the application are {@link app.DEFAULT_VALUES} @see [default values]{DEFAULT_VALUES}
 */
class WebfocusApp {

    /**
     * Creates a Webfocus App Instance
     * 
     * @param {Object} [configuration] - Configuration Object, the default is the object DEFAULT_VALUES
     */
    constructor(configuration){
        debug("constructor");
        this.configuration = Object.assign({}, DEFAULT_VALUES, configuration);
        // Configuration checks
        if( !Number.isSafeInteger(this.configuration.port) || this.configuration.port < 0 || this.configuration.port > 65535 ){
            warn("Invalid port in configuration, a random port will be provided on start");
            this.configuration.port = 0;
        }
        if( (typeof this.configuration.name !== 'string') && !(this.configuration.name instanceof String) ){
            warn("Unexpected Object \"name\" in configuration (%o)", configuration.name);
        }
        if( this.configuration.components ){
            warn("Ignoring components property of configuration");
        }
        this.configuration.components = []; 

        this.components = {};
        this.started = false;

        // Express application
        let app = this.app = express();
        
        app.set('json spaces', 2);
        app.set('view engine', 'pug');
        app.set('views', this.configuration.dirname)
        
        // Main express api middleware
        this.api = express.Router();
        // Enable JSON and HTTP-form-submit communication
        // Warning: Does *NOT* enable file uploading (multipart/form-data)
        //          use mutler (see https://github.com/expressjs/multer) on specific components.
        app.use("/api", [express.json({strict : false}), express.urlencoded({extended: true}), this.api])
        
        // Express initial handlers
        this.api.get("^/$", (req, res, next) => {
            debug("Route Api Handler")
            res.json(this.getAllComponentNames())
        })
        app.get('^/$', (req, res, next) => {
            debug("Route App Handler")
            res.render('layouts/index', this.pugObj({req}));
        })
    }

    /**
     * Creates an object 
     * @param {Object} objs
     * @returns {Object}
     */
    pugObj(objs){
        let obj = { ...objs };
        obj.basedir = this.app.get('views');
        obj.configuration = this.configuration;
        obj.getComponent = (urlname) => {
            let c = this.getComponent(urlname);
            return {
                urlname : c.urlname,
                name : c.name,
                description : c.description
            }
        }
        return obj;
    }

    /**
     * Starts the WebfocusApp instance.
     * @returns {Server}
     */
    start(){
        debug("started")
        if( this.started ){
            warn("Ignoring multiple start calls.");
            return null;
        } 
        this.started = true;

        this.emit("configuration", this.configuration);
        
        // Last express handlers
        this.api.use((req, res, next) => {
            debug("Not Found Api Handler on %s %s", req.method, req.path);
            res.status(404).json({error: `API Endpoint ${req.path} not found.`})
        })

        this.api.use((err, req, res, next) => {
            debug("Error Api Handler on %s %s: %s", req.method, req.path, err.message);
            res.status(500).json({error: err.message, stack: err.stack})
        })
        
        // Ensure webfocus-static, bootstrap and popper files are always available (such as fetch)
        this.app.use('/webfocus-static/',express.static(path.join(__dirname, 'static')));
    
        this.app.use('/bootstrap/', express.static(path.join(path.dirname(require.resolve('bootstrap/package.json')), 'dist')))
        this.app.use('/popperjs/', express.static(path.join(path.dirname(require.resolve('@popperjs/core/package.json')), 'dist')))

        // Serve static files under the static folder
        this.app.use(express.static(this.configuration.static));
        

        this.app.get("*", (req, res, next) => { // Not found handling
            debug("Not Found Handler (%s)", req.path);
            res.status(404).render('layouts/error', this.pugObj({req, error: `Not found ${req.path}`}));
        })

        this.app.all("*", (req, res, next) => { // Method Not Allowed handling
            res.status(400).render('layouts/error', this.pugObj({req, error: `Method not allowed (${req.method})`}));
        })
        
        this.app.use((err, req, res, next) => { // Internal error handling
            debug("Error Handler (%s)", req.path);
            res.status(500).render('layouts/error', this.pugObj({req, error:err.message, stack: err.stack}));
        })

        
        let server = this.app.listen(this.configuration.port, () => {
            let addr = server.address()
            debug("Server listenning on port %s", addr.port);
        });
        return server;
    }
    
    /**
     * Register an WebfocusComponent to this application.
     * @param {WebfocusComponent} Component to register.
     * @returns {void}
     */
    registerComponent(component){
        if( this.started ){
            warn("Ignoring component after start application started.");
            return false;
        }
        if( component.urlname in this.components ){
            warn("Ignoring component with the same urlname as a previous component. (component: %s)", component.urlname);
            return false;
        }
        if( RESERVED_URLNAMES.indexOf(component.urlname) >= 0 ){
            warn("Ignoring component with a reserved urlname. (component: %s)", component.urlname);
            return false;
        }
        debug("Registering component \"%s\"", component.urlname);

        this.components[component.urlname] = component;
        if( !component.hidden ){
            this.configuration.components.push(component.urlname);
        }

        component.emit("webfocusApp", this);

        // COMPONENT API
        this.api.use(`/${component.urlname}`, component.app);

        // STATIC FILES
        this.app.use(`/${component.urlname}`, component.staticApp, (req, res, next) => {
            debug("Component SSR Handler (%s %s)", req.method, req.path)
            if( req.method !== 'GET' && req.method !== 'HEAD' ) return next();
            let subpath = req.path;

            if( subpath.endsWith("/") ){
                subpath += "index";
            }

            if( subpath.indexOf('.') != -1 ){
                subpath = subpath.replace(/\.[^\.]*$/,''); // Remove extension
            }
            let pObj = this.pugObj({
                apibaseurl: `/api/${component.urlname}/`,
                componentbaseurl: `/${component.urlname}/`,
                component,
                req
            });
            res.render(path.join(component.dirname, subpath), pObj, (err, html) => {
                if( err ){
                    if( subpath == "/index" ){
                        component.debug("Error at - index.pug: %s", err.message )
                        next(err);
                    }
                    else if( err.message.indexOf("Failed to lookup") >= 0 ){
                        component.debug("Component specific view (%s) does not exit, using index.pug.", subpath);
                        res.render(path.join(component.dirname, 'index'), pObj);
                    }
                    else{
                        component.debug("Error at - %s.pug: %s", subpath, err.message);
                        next(err);
                    }
                }
                else{
                    res.send(html);
                }
            })
        })
        return true;
    }

    /**
     * @param {*} urlname - URL name of the component.
     * @returns {WebfocusComponent} The webfocus component instance with the given urlname.
     */
    getComponent(urlname){
        let r = this.components[urlname];
        if( !r ){
            warn("Component \"%s\" not fount.", urlname)
            return null;
        }
        return r;
    }

    /**
     * @returns {String[]} All the component urlnames currently known.
     */
    getAllComponentNames(){
        return Object.keys(this.components);
    }

    /**
     * Broadcast an event to the components currently known.
     * @param {*} name - Name of the event.
     * @param  {...any} obj - Data to share.
     */
    emit(name, ...obj){
        for(let c of Object.values(this.components)){
            c.emit(name, ...obj);
        }
    }
} 

module.exports = WebfocusApp;