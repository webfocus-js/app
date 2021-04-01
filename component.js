/**
 * WebfocusComponent module.
 * @module component
 */
const express = require("express");
const debug = require("debug");
const path = require("path");

const EMPTY = new Object(); 

/**
 * Class representing internal component Errors 
 */
class WebfocusComponentError extends Error {}

function isString(val){
    return typeof val === 'string' || val instanceof String;
}
/**
 * Class representing a component.
 * 
 */
class WebfocusComponent {
    #_configuration = EMPTY;
    #_onConfigurationReady = () => {};

    /**
     * Creates an instance of WebfocusComponent.
     * dirname property will be set to the directory where the constructor was called.
     * @param {String} name - Display name of the component.
     * @param {String} description - Description.
     * @param {String} dirname - Current working directory of the component. (usually __dirname)
     */
    constructor(name="", description="Generic Component Description", dirname){
        if( !isString(name) ){
            throw new WebfocusComponentError("Name argument provided is not a string");
        }
        if( !isString(description) ){
            throw new WebfocusComponentError("Description argument provided is not a string");
        }
        if( !isString(dirname) ){
            throw new WebfocusComponentError("Dirname argument provided is not a string");
        }
        this.name = name;
        this.urlname = name.replace(/\s+/g, '-').toLowerCase();
        this.app = express.Router();
        this.description = description;
        this.dirname = dirname;
        this.debug = debug(`webfocus:component:${name}`);
        this.onConfigurationReady = (cb=()=>{}) => {this.#_onConfigurationReady = cb}
    }

    /**
     * Sets the configuration object.
     * @throws WebfocusComponentError when setting the configuration more than once.
     */
    set configuration(configuration){
        if( this.#_configuration === EMPTY ){
            this.#_configuration = configuration;
            this.#_onConfigurationReady();
        }
        else{
            throw new WebfocusComponentError(`Attempting to override configuration object on component "${this.name}".`);
        }
    }

    /**
     * Returns a read-only configuration. This configuration can only be access after the onConfigurationReady function is called.
     */
    get configuration(){
        let self = this;
        return new Proxy(EMPTY, {
            set: function(){
                throw new WebfocusComponentError(`Attempting to override value on ${self.name} component's configuration.`)
            },
            get: function(_, prop){
                if( self.#_configuration === EMPTY ){
                    throw new WebfocusComponentError(`Attempting to access configuration before its initialisation on ${self.name} component.`);
                }
                return self.#_configuration[prop];
            }
        })
    }
}

/**
 * Creates an WebfocusComponent. Hides the need to pass __dirname explicitaly.
 * @param {String} name - Name to crete the component.
 * @param {String} description - Description of the component.
 */
module.exports = function createComponent(name, description){
    // https://github.com/detrohutt/caller-dirname/blob/master/src/index.ts
    const _ = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const dirname = path.dirname(new Error().stack.find(s => s.getFileName() != __filename).getFileName());
    Error.prepareStackTrace = _;
    return new WebfocusComponent(name, description, dirname);
}

module.exports.WebfocusComponent = WebfocusComponent;
module.exports.WebfocusComponentError = WebfocusComponentError;
