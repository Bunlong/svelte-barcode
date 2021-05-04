var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    const nodes_to_detach = new Set();
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
        for (const node of nodes_to_detach) {
            node.parentNode.removeChild(node);
        }
        nodes_to_detach.clear();
    }
    function insert(target, node, anchor) {
        if (is_hydrating) {
            nodes_to_detach.delete(node);
        }
        if (node.parentNode !== target || (anchor && node.nextSibling !== anchor)) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        if (is_hydrating) {
            nodes_to_detach.add(node);
        }
        else if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.38.1' }, detail)));
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    function noop$1() { }
    function add_location$1(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run$1(fn) {
        return fn();
    }
    function blank_object$1() {
        return Object.create(null);
    }
    function run_all$1(fns) {
        fns.forEach(run$1);
    }
    function is_function$1(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal$1(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty$1(obj) {
        return Object.keys(obj).length === 0;
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating$1 = false;
    const nodes_to_detach$1 = new Set();
    function start_hydrating$1() {
        is_hydrating$1 = true;
    }
    function end_hydrating$1() {
        is_hydrating$1 = false;
        for (const node of nodes_to_detach$1) {
            node.parentNode.removeChild(node);
        }
        nodes_to_detach$1.clear();
    }
    function insert$1(target, node, anchor) {
        if (is_hydrating$1) {
            nodes_to_detach$1.delete(node);
        }
        if (node.parentNode !== target || (anchor && node.nextSibling !== anchor)) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach$1(node) {
        if (is_hydrating$1) {
            nodes_to_detach$1.add(node);
        }
        else if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function element$1(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function empty() {
        return text('');
    }
    function attr$1(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children$1(element) {
        return Array.from(element.childNodes);
    }
    function custom_event$1(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component$1;
    function set_current_component$1(component) {
        current_component$1 = component;
    }
    function get_current_component() {
        if (!current_component$1)
            throw new Error('Function called outside component initialization');
        return current_component$1;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components$1 = [];
    const binding_callbacks$1 = [];
    const render_callbacks$1 = [];
    const flush_callbacks$1 = [];
    const resolved_promise$1 = Promise.resolve();
    let update_scheduled$1 = false;
    function schedule_update$1() {
        if (!update_scheduled$1) {
            update_scheduled$1 = true;
            resolved_promise$1.then(flush$1);
        }
    }
    function tick() {
        schedule_update$1();
        return resolved_promise$1;
    }
    function add_render_callback$1(fn) {
        render_callbacks$1.push(fn);
    }
    let flushing$1 = false;
    const seen_callbacks$1 = new Set();
    function flush$1() {
        if (flushing$1)
            return;
        flushing$1 = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components$1.length; i += 1) {
                const component = dirty_components$1[i];
                set_current_component$1(component);
                update$1(component.$$);
            }
            set_current_component$1(null);
            dirty_components$1.length = 0;
            while (binding_callbacks$1.length)
                binding_callbacks$1.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks$1.length; i += 1) {
                const callback = render_callbacks$1[i];
                if (!seen_callbacks$1.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks$1.add(callback);
                    callback();
                }
            }
            render_callbacks$1.length = 0;
        } while (dirty_components$1.length);
        while (flush_callbacks$1.length) {
            flush_callbacks$1.pop()();
        }
        update_scheduled$1 = false;
        flushing$1 = false;
        seen_callbacks$1.clear();
    }
    function update$1($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all$1($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback$1);
        }
    }
    const outroing$1 = new Set();
    function transition_in$1(block, local) {
        if (block && block.i) {
            outroing$1.delete(block);
            block.i(local);
        }
    }
    function mount_component$1(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback$1(() => {
                const new_on_destroy = on_mount.map(run$1).filter(is_function$1);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all$1(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback$1);
    }
    function destroy_component$1(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all$1($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty$1(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components$1.push(component);
            schedule_update$1();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init$1(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component$1;
        set_current_component$1(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop$1,
            not_equal,
            bound: blank_object$1(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object$1(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty$1(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all$1($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating$1();
                const nodes = children$1(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach$1);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in$1(component.$$.fragment);
            mount_component$1(component, options.target, options.anchor, options.customElement);
            end_hydrating$1();
            flush$1();
        }
        set_current_component$1(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent$1 {
        $destroy() {
            destroy_component$1(this, 1);
            this.$destroy = noop$1;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty$1($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev$1(type, detail) {
        document.dispatchEvent(custom_event$1(type, Object.assign({ version: '3.38.1' }, detail)));
    }
    function insert_dev$1(target, node, anchor) {
        dispatch_dev$1('SvelteDOMInsert', { target, node, anchor });
        insert$1(target, node, anchor);
    }
    function detach_dev$1(node) {
        dispatch_dev$1('SvelteDOMRemove', { node });
        detach$1(node);
    }
    function attr_dev$1(node, attribute, value) {
        attr$1(node, attribute, value);
        if (value == null)
            dispatch_dev$1('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev$1('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function validate_slots$1(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev$1 extends SvelteComponent$1 {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    function unwrapExports (x) {
    	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
    }

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var Barcode_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    var Barcode = function Barcode(data, options) {
    	_classCallCheck(this, Barcode);

    	this.data = data;
    	this.text = options.text || data;
    	this.options = options;
    };

    exports.default = Barcode;
    });

    unwrapExports(Barcode_1);

    var CODE39_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.CODE39 = undefined;

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // https://en.wikipedia.org/wiki/Code_39#Encoding

    var CODE39 = function (_Barcode) {
    	_inherits(CODE39, _Barcode);

    	function CODE39(data, options) {
    		_classCallCheck(this, CODE39);

    		data = data.toUpperCase();

    		// Calculate mod43 checksum if enabled
    		if (options.mod43) {
    			data += getCharacter(mod43checksum(data));
    		}

    		return _possibleConstructorReturn(this, (CODE39.__proto__ || Object.getPrototypeOf(CODE39)).call(this, data, options));
    	}

    	_createClass(CODE39, [{
    		key: "encode",
    		value: function encode() {
    			// First character is always a *
    			var result = getEncoding("*");

    			// Take every character and add the binary representation to the result
    			for (var i = 0; i < this.data.length; i++) {
    				result += getEncoding(this.data[i]) + "0";
    			}

    			// Last character is always a *
    			result += getEncoding("*");

    			return {
    				data: result,
    				text: this.text
    			};
    		}
    	}, {
    		key: "valid",
    		value: function valid() {
    			return this.data.search(/^[0-9A-Z\-\.\ \$\/\+\%]+$/) !== -1;
    		}
    	}]);

    	return CODE39;
    }(_Barcode3.default);

    // All characters. The position in the array is the (checksum) value


    var characters = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "-", ".", " ", "$", "/", "+", "%", "*"];

    // The decimal representation of the characters, is converted to the
    // corresponding binary with the getEncoding function
    var encodings = [20957, 29783, 23639, 30485, 20951, 29813, 23669, 20855, 29789, 23645, 29975, 23831, 30533, 22295, 30149, 24005, 21623, 29981, 23837, 22301, 30023, 23879, 30545, 22343, 30161, 24017, 21959, 30065, 23921, 22385, 29015, 18263, 29141, 17879, 29045, 18293, 17783, 29021, 18269, 17477, 17489, 17681, 20753, 35770];

    // Get the binary representation of a character by converting the encodings
    // from decimal to binary
    function getEncoding(character) {
    	return getBinary(characterValue(character));
    }

    function getBinary(characterValue) {
    	return encodings[characterValue].toString(2);
    }

    function getCharacter(characterValue) {
    	return characters[characterValue];
    }

    function characterValue(character) {
    	return characters.indexOf(character);
    }

    function mod43checksum(data) {
    	var checksum = 0;
    	for (var i = 0; i < data.length; i++) {
    		checksum += characterValue(data[i]);
    	}

    	checksum = checksum % 43;
    	return checksum;
    }

    exports.CODE39 = CODE39;
    });

    unwrapExports(CODE39_1);
    var CODE39_2 = CODE39_1.CODE39;

    var constants = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _SET_BY_CODE;

    function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

    // constants for internal usage
    var SET_A = exports.SET_A = 0;
    var SET_B = exports.SET_B = 1;
    var SET_C = exports.SET_C = 2;

    // Special characters
    var SHIFT = exports.SHIFT = 98;
    var START_A = exports.START_A = 103;
    var START_B = exports.START_B = 104;
    var START_C = exports.START_C = 105;
    var MODULO = exports.MODULO = 103;
    var STOP = exports.STOP = 106;
    var FNC1 = exports.FNC1 = 207;

    // Get set by start code
    var SET_BY_CODE = exports.SET_BY_CODE = (_SET_BY_CODE = {}, _defineProperty(_SET_BY_CODE, START_A, SET_A), _defineProperty(_SET_BY_CODE, START_B, SET_B), _defineProperty(_SET_BY_CODE, START_C, SET_C), _SET_BY_CODE);

    // Get next set by code
    var SWAP = exports.SWAP = {
    	101: SET_A,
    	100: SET_B,
    	99: SET_C
    };

    var A_START_CHAR = exports.A_START_CHAR = String.fromCharCode(208); // START_A + 105
    var B_START_CHAR = exports.B_START_CHAR = String.fromCharCode(209); // START_B + 105
    var C_START_CHAR = exports.C_START_CHAR = String.fromCharCode(210); // START_C + 105

    // 128A (Code Set A)
    // ASCII characters 00 to 95 (0–9, A–Z and control codes), special characters, and FNC 1–4
    var A_CHARS = exports.A_CHARS = "[\x00-\x5F\xC8-\xCF]";

    // 128B (Code Set B)
    // ASCII characters 32 to 127 (0–9, A–Z, a–z), special characters, and FNC 1–4
    var B_CHARS = exports.B_CHARS = "[\x20-\x7F\xC8-\xCF]";

    // 128C (Code Set C)
    // 00–99 (encodes two digits with a single code point) and FNC1
    var C_CHARS = exports.C_CHARS = "(\xCF*[0-9]{2}\xCF*)";

    // CODE128 includes 107 symbols:
    // 103 data symbols, 3 start symbols (A, B and C), and 1 stop symbol (the last one)
    // Each symbol consist of three black bars (1) and three white spaces (0).
    var BARS = exports.BARS = [11011001100, 11001101100, 11001100110, 10010011000, 10010001100, 10001001100, 10011001000, 10011000100, 10001100100, 11001001000, 11001000100, 11000100100, 10110011100, 10011011100, 10011001110, 10111001100, 10011101100, 10011100110, 11001110010, 11001011100, 11001001110, 11011100100, 11001110100, 11101101110, 11101001100, 11100101100, 11100100110, 11101100100, 11100110100, 11100110010, 11011011000, 11011000110, 11000110110, 10100011000, 10001011000, 10001000110, 10110001000, 10001101000, 10001100010, 11010001000, 11000101000, 11000100010, 10110111000, 10110001110, 10001101110, 10111011000, 10111000110, 10001110110, 11101110110, 11010001110, 11000101110, 11011101000, 11011100010, 11011101110, 11101011000, 11101000110, 11100010110, 11101101000, 11101100010, 11100011010, 11101111010, 11001000010, 11110001010, 10100110000, 10100001100, 10010110000, 10010000110, 10000101100, 10000100110, 10110010000, 10110000100, 10011010000, 10011000010, 10000110100, 10000110010, 11000010010, 11001010000, 11110111010, 11000010100, 10001111010, 10100111100, 10010111100, 10010011110, 10111100100, 10011110100, 10011110010, 11110100100, 11110010100, 11110010010, 11011011110, 11011110110, 11110110110, 10101111000, 10100011110, 10001011110, 10111101000, 10111100010, 11110101000, 11110100010, 10111011110, 10111101110, 11101011110, 11110101110, 11010000100, 11010010000, 11010011100, 1100011101011];
    });

    unwrapExports(constants);
    var constants_1 = constants.SET_A;
    var constants_2 = constants.SET_B;
    var constants_3 = constants.SET_C;
    var constants_4 = constants.SHIFT;
    var constants_5 = constants.START_A;
    var constants_6 = constants.START_B;
    var constants_7 = constants.START_C;
    var constants_8 = constants.MODULO;
    var constants_9 = constants.STOP;
    var constants_10 = constants.FNC1;
    var constants_11 = constants.SET_BY_CODE;
    var constants_12 = constants.SWAP;
    var constants_13 = constants.A_START_CHAR;
    var constants_14 = constants.B_START_CHAR;
    var constants_15 = constants.C_START_CHAR;
    var constants_16 = constants.A_CHARS;
    var constants_17 = constants.B_CHARS;
    var constants_18 = constants.C_CHARS;
    var constants_19 = constants.BARS;

    var CODE128_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _Barcode3 = _interopRequireDefault(Barcode_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    // This is the master class,
    // it does require the start code to be included in the string
    var CODE128 = function (_Barcode) {
    	_inherits(CODE128, _Barcode);

    	function CODE128(data, options) {
    		_classCallCheck(this, CODE128);

    		// Get array of ascii codes from data
    		var _this = _possibleConstructorReturn(this, (CODE128.__proto__ || Object.getPrototypeOf(CODE128)).call(this, data.substring(1), options));

    		_this.bytes = data.split('').map(function (char) {
    			return char.charCodeAt(0);
    		});
    		return _this;
    	}

    	_createClass(CODE128, [{
    		key: 'valid',
    		value: function valid() {
    			// ASCII value ranges 0-127, 200-211
    			return (/^[\x00-\x7F\xC8-\xD3]+$/.test(this.data)
    			);
    		}

    		// The public encoding function

    	}, {
    		key: 'encode',
    		value: function encode() {
    			var bytes = this.bytes;
    			// Remove the start code from the bytes and set its index
    			var startIndex = bytes.shift() - 105;
    			// Get start set by index
    			var startSet = constants.SET_BY_CODE[startIndex];

    			if (startSet === undefined) {
    				throw new RangeError('The encoding does not start with a start character.');
    			}

    			if (this.shouldEncodeAsEan128() === true) {
    				bytes.unshift(constants.FNC1);
    			}

    			// Start encode with the right type
    			var encodingResult = CODE128.next(bytes, 1, startSet);

    			return {
    				text: this.text === this.data ? this.text.replace(/[^\x20-\x7E]/g, '') : this.text,
    				data:
    				// Add the start bits
    				CODE128.getBar(startIndex) +
    				// Add the encoded bits
    				encodingResult.result +
    				// Add the checksum
    				CODE128.getBar((encodingResult.checksum + startIndex) % constants.MODULO) +
    				// Add the end bits
    				CODE128.getBar(constants.STOP)
    			};
    		}

    		// GS1-128/EAN-128

    	}, {
    		key: 'shouldEncodeAsEan128',
    		value: function shouldEncodeAsEan128() {
    			var isEAN128 = this.options.ean128 || false;
    			if (typeof isEAN128 === 'string') {
    				isEAN128 = isEAN128.toLowerCase() === 'true';
    			}
    			return isEAN128;
    		}

    		// Get a bar symbol by index

    	}], [{
    		key: 'getBar',
    		value: function getBar(index) {
    			return constants.BARS[index] ? constants.BARS[index].toString() : '';
    		}

    		// Correct an index by a set and shift it from the bytes array

    	}, {
    		key: 'correctIndex',
    		value: function correctIndex(bytes, set) {
    			if (set === constants.SET_A) {
    				var charCode = bytes.shift();
    				return charCode < 32 ? charCode + 64 : charCode - 32;
    			} else if (set === constants.SET_B) {
    				return bytes.shift() - 32;
    			} else {
    				return (bytes.shift() - 48) * 10 + bytes.shift() - 48;
    			}
    		}
    	}, {
    		key: 'next',
    		value: function next(bytes, pos, set) {
    			if (!bytes.length) {
    				return { result: '', checksum: 0 };
    			}

    			var nextCode = void 0,
    			    index = void 0;

    			// Special characters
    			if (bytes[0] >= 200) {
    				index = bytes.shift() - 105;
    				var nextSet = constants.SWAP[index];

    				// Swap to other set
    				if (nextSet !== undefined) {
    					nextCode = CODE128.next(bytes, pos + 1, nextSet);
    				}
    				// Continue on current set but encode a special character
    				else {
    						// Shift
    						if ((set === constants.SET_A || set === constants.SET_B) && index === constants.SHIFT) {
    							// Convert the next character so that is encoded correctly
    							bytes[0] = set === constants.SET_A ? bytes[0] > 95 ? bytes[0] - 96 : bytes[0] : bytes[0] < 32 ? bytes[0] + 96 : bytes[0];
    						}
    						nextCode = CODE128.next(bytes, pos + 1, set);
    					}
    			}
    			// Continue encoding
    			else {
    					index = CODE128.correctIndex(bytes, set);
    					nextCode = CODE128.next(bytes, pos + 1, set);
    				}

    			// Get the correct binary encoding and calculate the weight
    			var enc = CODE128.getBar(index);
    			var weight = index * pos;

    			return {
    				result: enc + nextCode.result,
    				checksum: weight + nextCode.checksum
    			};
    		}
    	}]);

    	return CODE128;
    }(_Barcode3.default);

    exports.default = CODE128;
    });

    unwrapExports(CODE128_1);

    var auto = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    // Match Set functions
    var matchSetALength = function matchSetALength(string) {
    	return string.match(new RegExp('^' + constants.A_CHARS + '*'))[0].length;
    };
    var matchSetBLength = function matchSetBLength(string) {
    	return string.match(new RegExp('^' + constants.B_CHARS + '*'))[0].length;
    };
    var matchSetC = function matchSetC(string) {
    	return string.match(new RegExp('^' + constants.C_CHARS + '*'))[0];
    };

    // CODE128A or CODE128B
    function autoSelectFromAB(string, isA) {
    	var ranges = isA ? constants.A_CHARS : constants.B_CHARS;
    	var untilC = string.match(new RegExp('^(' + ranges + '+?)(([0-9]{2}){2,})([^0-9]|$)'));

    	if (untilC) {
    		return untilC[1] + String.fromCharCode(204) + autoSelectFromC(string.substring(untilC[1].length));
    	}

    	var chars = string.match(new RegExp('^' + ranges + '+'))[0];

    	if (chars.length === string.length) {
    		return string;
    	}

    	return chars + String.fromCharCode(isA ? 205 : 206) + autoSelectFromAB(string.substring(chars.length), !isA);
    }

    // CODE128C
    function autoSelectFromC(string) {
    	var cMatch = matchSetC(string);
    	var length = cMatch.length;

    	if (length === string.length) {
    		return string;
    	}

    	string = string.substring(length);

    	// Select A/B depending on the longest match
    	var isA = matchSetALength(string) >= matchSetBLength(string);
    	return cMatch + String.fromCharCode(isA ? 206 : 205) + autoSelectFromAB(string, isA);
    }

    // Detect Code Set (A, B or C) and format the string

    exports.default = function (string) {
    	var newString = void 0;
    	var cLength = matchSetC(string).length;

    	// Select 128C if the string start with enough digits
    	if (cLength >= 2) {
    		newString = constants.C_START_CHAR + autoSelectFromC(string);
    	} else {
    		// Select A/B depending on the longest match
    		var isA = matchSetALength(string) > matchSetBLength(string);
    		newString = (isA ? constants.A_START_CHAR : constants.B_START_CHAR) + autoSelectFromAB(string, isA);
    	}

    	return newString.replace(/[\xCD\xCE]([^])[\xCD\xCE]/, // Any sequence between 205 and 206 characters
    	function (match, char) {
    		return String.fromCharCode(203) + char;
    	});
    };
    });

    unwrapExports(auto);

    var CODE128_AUTO = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    var _CODE3 = _interopRequireDefault(CODE128_1);



    var _auto2 = _interopRequireDefault(auto);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var CODE128AUTO = function (_CODE) {
    	_inherits(CODE128AUTO, _CODE);

    	function CODE128AUTO(data, options) {
    		_classCallCheck(this, CODE128AUTO);

    		// ASCII value ranges 0-127, 200-211
    		if (/^[\x00-\x7F\xC8-\xD3]+$/.test(data)) {
    			var _this = _possibleConstructorReturn(this, (CODE128AUTO.__proto__ || Object.getPrototypeOf(CODE128AUTO)).call(this, (0, _auto2.default)(data), options));
    		} else {
    			var _this = _possibleConstructorReturn(this, (CODE128AUTO.__proto__ || Object.getPrototypeOf(CODE128AUTO)).call(this, data, options));
    		}
    		return _possibleConstructorReturn(_this);
    	}

    	return CODE128AUTO;
    }(_CODE3.default);

    exports.default = CODE128AUTO;
    });

    unwrapExports(CODE128_AUTO);

    var CODE128A_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _CODE3 = _interopRequireDefault(CODE128_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var CODE128A = function (_CODE) {
    	_inherits(CODE128A, _CODE);

    	function CODE128A(string, options) {
    		_classCallCheck(this, CODE128A);

    		return _possibleConstructorReturn(this, (CODE128A.__proto__ || Object.getPrototypeOf(CODE128A)).call(this, constants.A_START_CHAR + string, options));
    	}

    	_createClass(CODE128A, [{
    		key: 'valid',
    		value: function valid() {
    			return new RegExp('^' + constants.A_CHARS + '+$').test(this.data);
    		}
    	}]);

    	return CODE128A;
    }(_CODE3.default);

    exports.default = CODE128A;
    });

    unwrapExports(CODE128A_1);

    var CODE128B_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _CODE3 = _interopRequireDefault(CODE128_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var CODE128B = function (_CODE) {
    	_inherits(CODE128B, _CODE);

    	function CODE128B(string, options) {
    		_classCallCheck(this, CODE128B);

    		return _possibleConstructorReturn(this, (CODE128B.__proto__ || Object.getPrototypeOf(CODE128B)).call(this, constants.B_START_CHAR + string, options));
    	}

    	_createClass(CODE128B, [{
    		key: 'valid',
    		value: function valid() {
    			return new RegExp('^' + constants.B_CHARS + '+$').test(this.data);
    		}
    	}]);

    	return CODE128B;
    }(_CODE3.default);

    exports.default = CODE128B;
    });

    unwrapExports(CODE128B_1);

    var CODE128C_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _CODE3 = _interopRequireDefault(CODE128_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var CODE128C = function (_CODE) {
    	_inherits(CODE128C, _CODE);

    	function CODE128C(string, options) {
    		_classCallCheck(this, CODE128C);

    		return _possibleConstructorReturn(this, (CODE128C.__proto__ || Object.getPrototypeOf(CODE128C)).call(this, constants.C_START_CHAR + string, options));
    	}

    	_createClass(CODE128C, [{
    		key: 'valid',
    		value: function valid() {
    			return new RegExp('^' + constants.C_CHARS + '+$').test(this.data);
    		}
    	}]);

    	return CODE128C;
    }(_CODE3.default);

    exports.default = CODE128C;
    });

    unwrapExports(CODE128C_1);

    var CODE128 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.CODE128C = exports.CODE128B = exports.CODE128A = exports.CODE128 = undefined;



    var _CODE128_AUTO2 = _interopRequireDefault(CODE128_AUTO);



    var _CODE128A2 = _interopRequireDefault(CODE128A_1);



    var _CODE128B2 = _interopRequireDefault(CODE128B_1);



    var _CODE128C2 = _interopRequireDefault(CODE128C_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    exports.CODE128 = _CODE128_AUTO2.default;
    exports.CODE128A = _CODE128A2.default;
    exports.CODE128B = _CODE128B2.default;
    exports.CODE128C = _CODE128C2.default;
    });

    unwrapExports(CODE128);
    var CODE128_1$1 = CODE128.CODE128C;
    var CODE128_2 = CODE128.CODE128B;
    var CODE128_3 = CODE128.CODE128A;
    var CODE128_4 = CODE128.CODE128;

    var constants$1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    // Standard start end and middle bits
    var SIDE_BIN = exports.SIDE_BIN = '101';
    var MIDDLE_BIN = exports.MIDDLE_BIN = '01010';

    var BINARIES = exports.BINARIES = {
    	'L': [// The L (left) type of encoding
    	'0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'],
    	'G': [// The G type of encoding
    	'0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'],
    	'R': [// The R (right) type of encoding
    	'1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'],
    	'O': [// The O (odd) encoding for UPC-E
    	'0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'],
    	'E': [// The E (even) encoding for UPC-E
    	'0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
    };

    // Define the EAN-2 structure
    var EAN2_STRUCTURE = exports.EAN2_STRUCTURE = ['LL', 'LG', 'GL', 'GG'];

    // Define the EAN-5 structure
    var EAN5_STRUCTURE = exports.EAN5_STRUCTURE = ['GGLLL', 'GLGLL', 'GLLGL', 'GLLLG', 'LGGLL', 'LLGGL', 'LLLGG', 'LGLGL', 'LGLLG', 'LLGLG'];

    // Define the EAN-13 structure
    var EAN13_STRUCTURE = exports.EAN13_STRUCTURE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    });

    unwrapExports(constants$1);
    var constants_1$1 = constants$1.SIDE_BIN;
    var constants_2$1 = constants$1.MIDDLE_BIN;
    var constants_3$1 = constants$1.BINARIES;
    var constants_4$1 = constants$1.EAN2_STRUCTURE;
    var constants_5$1 = constants$1.EAN5_STRUCTURE;
    var constants_6$1 = constants$1.EAN13_STRUCTURE;

    var encoder = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    // Encode data string
    var encode = function encode(data, structure, separator) {
    	var encoded = data.split('').map(function (val, idx) {
    		return constants$1.BINARIES[structure[idx]];
    	}).map(function (val, idx) {
    		return val ? val[data[idx]] : '';
    	});

    	if (separator) {
    		var last = data.length - 1;
    		encoded = encoded.map(function (val, idx) {
    			return idx < last ? val + separator : val;
    		});
    	}

    	return encoded.join('');
    };

    exports.default = encode;
    });

    unwrapExports(encoder);

    var EAN_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();





    var _encoder2 = _interopRequireDefault(encoder);



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    // Base class for EAN8 & EAN13
    var EAN = function (_Barcode) {
    	_inherits(EAN, _Barcode);

    	function EAN(data, options) {
    		_classCallCheck(this, EAN);

    		// Make sure the font is not bigger than the space between the guard bars
    		var _this = _possibleConstructorReturn(this, (EAN.__proto__ || Object.getPrototypeOf(EAN)).call(this, data, options));

    		_this.fontSize = !options.flat && options.fontSize > options.width * 10 ? options.width * 10 : options.fontSize;

    		// Make the guard bars go down half the way of the text
    		_this.guardHeight = options.height + _this.fontSize / 2 + options.textMargin;
    		return _this;
    	}

    	_createClass(EAN, [{
    		key: 'encode',
    		value: function encode() {
    			return this.options.flat ? this.encodeFlat() : this.encodeGuarded();
    		}
    	}, {
    		key: 'leftText',
    		value: function leftText(from, to) {
    			return this.text.substr(from, to);
    		}
    	}, {
    		key: 'leftEncode',
    		value: function leftEncode(data, structure) {
    			return (0, _encoder2.default)(data, structure);
    		}
    	}, {
    		key: 'rightText',
    		value: function rightText(from, to) {
    			return this.text.substr(from, to);
    		}
    	}, {
    		key: 'rightEncode',
    		value: function rightEncode(data, structure) {
    			return (0, _encoder2.default)(data, structure);
    		}
    	}, {
    		key: 'encodeGuarded',
    		value: function encodeGuarded() {
    			var textOptions = { fontSize: this.fontSize };
    			var guardOptions = { height: this.guardHeight };

    			return [{ data: constants$1.SIDE_BIN, options: guardOptions }, { data: this.leftEncode(), text: this.leftText(), options: textOptions }, { data: constants$1.MIDDLE_BIN, options: guardOptions }, { data: this.rightEncode(), text: this.rightText(), options: textOptions }, { data: constants$1.SIDE_BIN, options: guardOptions }];
    		}
    	}, {
    		key: 'encodeFlat',
    		value: function encodeFlat() {
    			var data = [constants$1.SIDE_BIN, this.leftEncode(), constants$1.MIDDLE_BIN, this.rightEncode(), constants$1.SIDE_BIN];

    			return {
    				data: data.join(''),
    				text: this.text
    			};
    		}
    	}]);

    	return EAN;
    }(_Barcode3.default);

    exports.default = EAN;
    });

    unwrapExports(EAN_1);

    var EAN13_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

    var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };





    var _EAN3 = _interopRequireDefault(EAN_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // https://en.wikipedia.org/wiki/International_Article_Number_(EAN)#Binary_encoding_of_data_digits_into_EAN-13_barcode

    // Calculate the checksum digit
    // https://en.wikipedia.org/wiki/International_Article_Number_(EAN)#Calculation_of_checksum_digit
    var checksum = function checksum(number) {
    	var res = number.substr(0, 12).split('').map(function (n) {
    		return +n;
    	}).reduce(function (sum, a, idx) {
    		return idx % 2 ? sum + a * 3 : sum + a;
    	}, 0);

    	return (10 - res % 10) % 10;
    };

    var EAN13 = function (_EAN) {
    	_inherits(EAN13, _EAN);

    	function EAN13(data, options) {
    		_classCallCheck(this, EAN13);

    		// Add checksum if it does not exist
    		if (data.search(/^[0-9]{12}$/) !== -1) {
    			data += checksum(data);
    		}

    		// Adds a last character to the end of the barcode
    		var _this = _possibleConstructorReturn(this, (EAN13.__proto__ || Object.getPrototypeOf(EAN13)).call(this, data, options));

    		_this.lastChar = options.lastChar;
    		return _this;
    	}

    	_createClass(EAN13, [{
    		key: 'valid',
    		value: function valid() {
    			return this.data.search(/^[0-9]{13}$/) !== -1 && +this.data[12] === checksum(this.data);
    		}
    	}, {
    		key: 'leftText',
    		value: function leftText() {
    			return _get(EAN13.prototype.__proto__ || Object.getPrototypeOf(EAN13.prototype), 'leftText', this).call(this, 1, 6);
    		}
    	}, {
    		key: 'leftEncode',
    		value: function leftEncode() {
    			var data = this.data.substr(1, 6);
    			var structure = constants$1.EAN13_STRUCTURE[this.data[0]];
    			return _get(EAN13.prototype.__proto__ || Object.getPrototypeOf(EAN13.prototype), 'leftEncode', this).call(this, data, structure);
    		}
    	}, {
    		key: 'rightText',
    		value: function rightText() {
    			return _get(EAN13.prototype.__proto__ || Object.getPrototypeOf(EAN13.prototype), 'rightText', this).call(this, 7, 6);
    		}
    	}, {
    		key: 'rightEncode',
    		value: function rightEncode() {
    			var data = this.data.substr(7, 6);
    			return _get(EAN13.prototype.__proto__ || Object.getPrototypeOf(EAN13.prototype), 'rightEncode', this).call(this, data, 'RRRRRR');
    		}

    		// The "standard" way of printing EAN13 barcodes with guard bars

    	}, {
    		key: 'encodeGuarded',
    		value: function encodeGuarded() {
    			var data = _get(EAN13.prototype.__proto__ || Object.getPrototypeOf(EAN13.prototype), 'encodeGuarded', this).call(this);

    			// Extend data with left digit & last character
    			if (this.options.displayValue) {
    				data.unshift({
    					data: '000000000000',
    					text: this.text.substr(0, 1),
    					options: { textAlign: 'left', fontSize: this.fontSize }
    				});

    				if (this.options.lastChar) {
    					data.push({
    						data: '00'
    					});
    					data.push({
    						data: '00000',
    						text: this.options.lastChar,
    						options: { fontSize: this.fontSize }
    					});
    				}
    			}

    			return data;
    		}
    	}]);

    	return EAN13;
    }(_EAN3.default);

    exports.default = EAN13;
    });

    unwrapExports(EAN13_1);

    var EAN8_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

    var _get = function get(object, property, receiver) { if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { return get(parent, property, receiver); } } else if ("value" in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } };



    var _EAN3 = _interopRequireDefault(EAN_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // http://www.barcodeisland.com/ean8.phtml

    // Calculate the checksum digit
    var checksum = function checksum(number) {
    	var res = number.substr(0, 7).split('').map(function (n) {
    		return +n;
    	}).reduce(function (sum, a, idx) {
    		return idx % 2 ? sum + a : sum + a * 3;
    	}, 0);

    	return (10 - res % 10) % 10;
    };

    var EAN8 = function (_EAN) {
    	_inherits(EAN8, _EAN);

    	function EAN8(data, options) {
    		_classCallCheck(this, EAN8);

    		// Add checksum if it does not exist
    		if (data.search(/^[0-9]{7}$/) !== -1) {
    			data += checksum(data);
    		}

    		return _possibleConstructorReturn(this, (EAN8.__proto__ || Object.getPrototypeOf(EAN8)).call(this, data, options));
    	}

    	_createClass(EAN8, [{
    		key: 'valid',
    		value: function valid() {
    			return this.data.search(/^[0-9]{8}$/) !== -1 && +this.data[7] === checksum(this.data);
    		}
    	}, {
    		key: 'leftText',
    		value: function leftText() {
    			return _get(EAN8.prototype.__proto__ || Object.getPrototypeOf(EAN8.prototype), 'leftText', this).call(this, 0, 4);
    		}
    	}, {
    		key: 'leftEncode',
    		value: function leftEncode() {
    			var data = this.data.substr(0, 4);
    			return _get(EAN8.prototype.__proto__ || Object.getPrototypeOf(EAN8.prototype), 'leftEncode', this).call(this, data, 'LLLL');
    		}
    	}, {
    		key: 'rightText',
    		value: function rightText() {
    			return _get(EAN8.prototype.__proto__ || Object.getPrototypeOf(EAN8.prototype), 'rightText', this).call(this, 4, 4);
    		}
    	}, {
    		key: 'rightEncode',
    		value: function rightEncode() {
    			var data = this.data.substr(4, 4);
    			return _get(EAN8.prototype.__proto__ || Object.getPrototypeOf(EAN8.prototype), 'rightEncode', this).call(this, data, 'RRRR');
    		}
    	}]);

    	return EAN8;
    }(_EAN3.default);

    exports.default = EAN8;
    });

    unwrapExports(EAN8_1);

    var EAN5_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();





    var _encoder2 = _interopRequireDefault(encoder);



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // https://en.wikipedia.org/wiki/EAN_5#Encoding

    var checksum = function checksum(data) {
    	var result = data.split('').map(function (n) {
    		return +n;
    	}).reduce(function (sum, a, idx) {
    		return idx % 2 ? sum + a * 9 : sum + a * 3;
    	}, 0);
    	return result % 10;
    };

    var EAN5 = function (_Barcode) {
    	_inherits(EAN5, _Barcode);

    	function EAN5(data, options) {
    		_classCallCheck(this, EAN5);

    		return _possibleConstructorReturn(this, (EAN5.__proto__ || Object.getPrototypeOf(EAN5)).call(this, data, options));
    	}

    	_createClass(EAN5, [{
    		key: 'valid',
    		value: function valid() {
    			return this.data.search(/^[0-9]{5}$/) !== -1;
    		}
    	}, {
    		key: 'encode',
    		value: function encode() {
    			var structure = constants$1.EAN5_STRUCTURE[checksum(this.data)];
    			return {
    				data: '1011' + (0, _encoder2.default)(this.data, structure, '01'),
    				text: this.text
    			};
    		}
    	}]);

    	return EAN5;
    }(_Barcode3.default);

    exports.default = EAN5;
    });

    unwrapExports(EAN5_1);

    var EAN2_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();





    var _encoder2 = _interopRequireDefault(encoder);



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // https://en.wikipedia.org/wiki/EAN_2#Encoding

    var EAN2 = function (_Barcode) {
    	_inherits(EAN2, _Barcode);

    	function EAN2(data, options) {
    		_classCallCheck(this, EAN2);

    		return _possibleConstructorReturn(this, (EAN2.__proto__ || Object.getPrototypeOf(EAN2)).call(this, data, options));
    	}

    	_createClass(EAN2, [{
    		key: 'valid',
    		value: function valid() {
    			return this.data.search(/^[0-9]{2}$/) !== -1;
    		}
    	}, {
    		key: 'encode',
    		value: function encode() {
    			// Choose the structure based on the number mod 4
    			var structure = constants$1.EAN2_STRUCTURE[parseInt(this.data) % 4];
    			return {
    				// Start bits + Encode the two digits with 01 in between
    				data: '1011' + (0, _encoder2.default)(this.data, structure, '01'),
    				text: this.text
    			};
    		}
    	}]);

    	return EAN2;
    }(_Barcode3.default);

    exports.default = EAN2;
    });

    unwrapExports(EAN2_1);

    var UPC_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

    exports.checksum = checksum;



    var _encoder2 = _interopRequireDefault(encoder);



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // https://en.wikipedia.org/wiki/Universal_Product_Code#Encoding

    var UPC = function (_Barcode) {
    	_inherits(UPC, _Barcode);

    	function UPC(data, options) {
    		_classCallCheck(this, UPC);

    		// Add checksum if it does not exist
    		if (data.search(/^[0-9]{11}$/) !== -1) {
    			data += checksum(data);
    		}

    		var _this = _possibleConstructorReturn(this, (UPC.__proto__ || Object.getPrototypeOf(UPC)).call(this, data, options));

    		_this.displayValue = options.displayValue;

    		// Make sure the font is not bigger than the space between the guard bars
    		if (options.fontSize > options.width * 10) {
    			_this.fontSize = options.width * 10;
    		} else {
    			_this.fontSize = options.fontSize;
    		}

    		// Make the guard bars go down half the way of the text
    		_this.guardHeight = options.height + _this.fontSize / 2 + options.textMargin;
    		return _this;
    	}

    	_createClass(UPC, [{
    		key: "valid",
    		value: function valid() {
    			return this.data.search(/^[0-9]{12}$/) !== -1 && this.data[11] == checksum(this.data);
    		}
    	}, {
    		key: "encode",
    		value: function encode() {
    			if (this.options.flat) {
    				return this.flatEncoding();
    			} else {
    				return this.guardedEncoding();
    			}
    		}
    	}, {
    		key: "flatEncoding",
    		value: function flatEncoding() {
    			var result = "";

    			result += "101";
    			result += (0, _encoder2.default)(this.data.substr(0, 6), "LLLLLL");
    			result += "01010";
    			result += (0, _encoder2.default)(this.data.substr(6, 6), "RRRRRR");
    			result += "101";

    			return {
    				data: result,
    				text: this.text
    			};
    		}
    	}, {
    		key: "guardedEncoding",
    		value: function guardedEncoding() {
    			var result = [];

    			// Add the first digit
    			if (this.displayValue) {
    				result.push({
    					data: "00000000",
    					text: this.text.substr(0, 1),
    					options: { textAlign: "left", fontSize: this.fontSize }
    				});
    			}

    			// Add the guard bars
    			result.push({
    				data: "101" + (0, _encoder2.default)(this.data[0], "L"),
    				options: { height: this.guardHeight }
    			});

    			// Add the left side
    			result.push({
    				data: (0, _encoder2.default)(this.data.substr(1, 5), "LLLLL"),
    				text: this.text.substr(1, 5),
    				options: { fontSize: this.fontSize }
    			});

    			// Add the middle bits
    			result.push({
    				data: "01010",
    				options: { height: this.guardHeight }
    			});

    			// Add the right side
    			result.push({
    				data: (0, _encoder2.default)(this.data.substr(6, 5), "RRRRR"),
    				text: this.text.substr(6, 5),
    				options: { fontSize: this.fontSize }
    			});

    			// Add the end bits
    			result.push({
    				data: (0, _encoder2.default)(this.data[11], "R") + "101",
    				options: { height: this.guardHeight }
    			});

    			// Add the last digit
    			if (this.displayValue) {
    				result.push({
    					data: "00000000",
    					text: this.text.substr(11, 1),
    					options: { textAlign: "right", fontSize: this.fontSize }
    				});
    			}

    			return result;
    		}
    	}]);

    	return UPC;
    }(_Barcode3.default);

    // Calulate the checksum digit
    // https://en.wikipedia.org/wiki/International_Article_Number_(EAN)#Calculation_of_checksum_digit


    function checksum(number) {
    	var result = 0;

    	var i;
    	for (i = 1; i < 11; i += 2) {
    		result += parseInt(number[i]);
    	}
    	for (i = 0; i < 11; i += 2) {
    		result += parseInt(number[i]) * 3;
    	}

    	return (10 - result % 10) % 10;
    }

    exports.default = UPC;
    });

    unwrapExports(UPC_1);
    var UPC_2 = UPC_1.checksum;

    var UPCE_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _encoder2 = _interopRequireDefault(encoder);



    var _Barcode3 = _interopRequireDefault(Barcode_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation:
    // https://en.wikipedia.org/wiki/Universal_Product_Code#Encoding
    //
    // UPC-E documentation:
    // https://en.wikipedia.org/wiki/Universal_Product_Code#UPC-E

    var EXPANSIONS = ["XX00000XXX", "XX10000XXX", "XX20000XXX", "XXX00000XX", "XXXX00000X", "XXXXX00005", "XXXXX00006", "XXXXX00007", "XXXXX00008", "XXXXX00009"];

    var PARITIES = [["EEEOOO", "OOOEEE"], ["EEOEOO", "OOEOEE"], ["EEOOEO", "OOEEOE"], ["EEOOOE", "OOEEEO"], ["EOEEOO", "OEOOEE"], ["EOOEEO", "OEEOOE"], ["EOOOEE", "OEEEOO"], ["EOEOEO", "OEOEOE"], ["EOEOOE", "OEOEEO"], ["EOOEOE", "OEEOEO"]];

    var UPCE = function (_Barcode) {
    	_inherits(UPCE, _Barcode);

    	function UPCE(data, options) {
    		_classCallCheck(this, UPCE);

    		var _this = _possibleConstructorReturn(this, (UPCE.__proto__ || Object.getPrototypeOf(UPCE)).call(this, data, options));
    		// Code may be 6 or 8 digits;
    		// A 7 digit code is ambiguous as to whether the extra digit
    		// is a UPC-A check or number system digit.


    		_this.isValid = false;
    		if (data.search(/^[0-9]{6}$/) !== -1) {
    			_this.middleDigits = data;
    			_this.upcA = expandToUPCA(data, "0");
    			_this.text = options.text || '' + _this.upcA[0] + data + _this.upcA[_this.upcA.length - 1];
    			_this.isValid = true;
    		} else if (data.search(/^[01][0-9]{7}$/) !== -1) {
    			_this.middleDigits = data.substring(1, data.length - 1);
    			_this.upcA = expandToUPCA(_this.middleDigits, data[0]);

    			if (_this.upcA[_this.upcA.length - 1] === data[data.length - 1]) {
    				_this.isValid = true;
    			} else {
    				// checksum mismatch
    				return _possibleConstructorReturn(_this);
    			}
    		} else {
    			return _possibleConstructorReturn(_this);
    		}

    		_this.displayValue = options.displayValue;

    		// Make sure the font is not bigger than the space between the guard bars
    		if (options.fontSize > options.width * 10) {
    			_this.fontSize = options.width * 10;
    		} else {
    			_this.fontSize = options.fontSize;
    		}

    		// Make the guard bars go down half the way of the text
    		_this.guardHeight = options.height + _this.fontSize / 2 + options.textMargin;
    		return _this;
    	}

    	_createClass(UPCE, [{
    		key: 'valid',
    		value: function valid() {
    			return this.isValid;
    		}
    	}, {
    		key: 'encode',
    		value: function encode() {
    			if (this.options.flat) {
    				return this.flatEncoding();
    			} else {
    				return this.guardedEncoding();
    			}
    		}
    	}, {
    		key: 'flatEncoding',
    		value: function flatEncoding() {
    			var result = "";

    			result += "101";
    			result += this.encodeMiddleDigits();
    			result += "010101";

    			return {
    				data: result,
    				text: this.text
    			};
    		}
    	}, {
    		key: 'guardedEncoding',
    		value: function guardedEncoding() {
    			var result = [];

    			// Add the UPC-A number system digit beneath the quiet zone
    			if (this.displayValue) {
    				result.push({
    					data: "00000000",
    					text: this.text[0],
    					options: { textAlign: "left", fontSize: this.fontSize }
    				});
    			}

    			// Add the guard bars
    			result.push({
    				data: "101",
    				options: { height: this.guardHeight }
    			});

    			// Add the 6 UPC-E digits
    			result.push({
    				data: this.encodeMiddleDigits(),
    				text: this.text.substring(1, 7),
    				options: { fontSize: this.fontSize }
    			});

    			// Add the end bits
    			result.push({
    				data: "010101",
    				options: { height: this.guardHeight }
    			});

    			// Add the UPC-A check digit beneath the quiet zone
    			if (this.displayValue) {
    				result.push({
    					data: "00000000",
    					text: this.text[7],
    					options: { textAlign: "right", fontSize: this.fontSize }
    				});
    			}

    			return result;
    		}
    	}, {
    		key: 'encodeMiddleDigits',
    		value: function encodeMiddleDigits() {
    			var numberSystem = this.upcA[0];
    			var checkDigit = this.upcA[this.upcA.length - 1];
    			var parity = PARITIES[parseInt(checkDigit)][parseInt(numberSystem)];
    			return (0, _encoder2.default)(this.middleDigits, parity);
    		}
    	}]);

    	return UPCE;
    }(_Barcode3.default);

    function expandToUPCA(middleDigits, numberSystem) {
    	var lastUpcE = parseInt(middleDigits[middleDigits.length - 1]);
    	var expansion = EXPANSIONS[lastUpcE];

    	var result = "";
    	var digitIndex = 0;
    	for (var i = 0; i < expansion.length; i++) {
    		var c = expansion[i];
    		if (c === 'X') {
    			result += middleDigits[digitIndex++];
    		} else {
    			result += c;
    		}
    	}

    	result = '' + numberSystem + result;
    	return '' + result + (0, UPC_1.checksum)(result);
    }

    exports.default = UPCE;
    });

    unwrapExports(UPCE_1);

    var EAN_UPC = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.UPCE = exports.UPC = exports.EAN2 = exports.EAN5 = exports.EAN8 = exports.EAN13 = undefined;



    var _EAN2 = _interopRequireDefault(EAN13_1);



    var _EAN4 = _interopRequireDefault(EAN8_1);



    var _EAN6 = _interopRequireDefault(EAN5_1);



    var _EAN8 = _interopRequireDefault(EAN2_1);



    var _UPC2 = _interopRequireDefault(UPC_1);



    var _UPCE2 = _interopRequireDefault(UPCE_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    exports.EAN13 = _EAN2.default;
    exports.EAN8 = _EAN4.default;
    exports.EAN5 = _EAN6.default;
    exports.EAN2 = _EAN8.default;
    exports.UPC = _UPC2.default;
    exports.UPCE = _UPCE2.default;
    });

    unwrapExports(EAN_UPC);
    var EAN_UPC_1 = EAN_UPC.UPCE;
    var EAN_UPC_2 = EAN_UPC.UPC;
    var EAN_UPC_3 = EAN_UPC.EAN2;
    var EAN_UPC_4 = EAN_UPC.EAN5;
    var EAN_UPC_5 = EAN_UPC.EAN8;
    var EAN_UPC_6 = EAN_UPC.EAN13;

    var constants$2 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    var START_BIN = exports.START_BIN = '1010';
    var END_BIN = exports.END_BIN = '11101';

    var BINARIES = exports.BINARIES = ['00110', '10001', '01001', '11000', '00101', '10100', '01100', '00011', '10010', '01010'];
    });

    unwrapExports(constants$2);
    var constants_1$2 = constants$2.START_BIN;
    var constants_2$2 = constants$2.END_BIN;
    var constants_3$2 = constants$2.BINARIES;

    var ITF_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();





    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var ITF = function (_Barcode) {
    	_inherits(ITF, _Barcode);

    	function ITF() {
    		_classCallCheck(this, ITF);

    		return _possibleConstructorReturn(this, (ITF.__proto__ || Object.getPrototypeOf(ITF)).apply(this, arguments));
    	}

    	_createClass(ITF, [{
    		key: 'valid',
    		value: function valid() {
    			return this.data.search(/^([0-9]{2})+$/) !== -1;
    		}
    	}, {
    		key: 'encode',
    		value: function encode() {
    			var _this2 = this;

    			// Calculate all the digit pairs
    			var encoded = this.data.match(/.{2}/g).map(function (pair) {
    				return _this2.encodePair(pair);
    			}).join('');

    			return {
    				data: constants$2.START_BIN + encoded + constants$2.END_BIN,
    				text: this.text
    			};
    		}

    		// Calculate the data of a number pair

    	}, {
    		key: 'encodePair',
    		value: function encodePair(pair) {
    			var second = constants$2.BINARIES[pair[1]];

    			return constants$2.BINARIES[pair[0]].split('').map(function (first, idx) {
    				return (first === '1' ? '111' : '1') + (second[idx] === '1' ? '000' : '0');
    			}).join('');
    		}
    	}]);

    	return ITF;
    }(_Barcode3.default);

    exports.default = ITF;
    });

    unwrapExports(ITF_1);

    var ITF14_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _ITF3 = _interopRequireDefault(ITF_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    // Calculate the checksum digit
    var checksum = function checksum(data) {
    	var res = data.substr(0, 13).split('').map(function (num) {
    		return parseInt(num, 10);
    	}).reduce(function (sum, n, idx) {
    		return sum + n * (3 - idx % 2 * 2);
    	}, 0);

    	return Math.ceil(res / 10) * 10 - res;
    };

    var ITF14 = function (_ITF) {
    	_inherits(ITF14, _ITF);

    	function ITF14(data, options) {
    		_classCallCheck(this, ITF14);

    		// Add checksum if it does not exist
    		if (data.search(/^[0-9]{13}$/) !== -1) {
    			data += checksum(data);
    		}
    		return _possibleConstructorReturn(this, (ITF14.__proto__ || Object.getPrototypeOf(ITF14)).call(this, data, options));
    	}

    	_createClass(ITF14, [{
    		key: 'valid',
    		value: function valid() {
    			return this.data.search(/^[0-9]{14}$/) !== -1 && +this.data[13] === checksum(this.data);
    		}
    	}]);

    	return ITF14;
    }(_ITF3.default);

    exports.default = ITF14;
    });

    unwrapExports(ITF14_1);

    var ITF = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.ITF14 = exports.ITF = undefined;



    var _ITF2 = _interopRequireDefault(ITF_1);



    var _ITF4 = _interopRequireDefault(ITF14_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    exports.ITF = _ITF2.default;
    exports.ITF14 = _ITF4.default;
    });

    unwrapExports(ITF);
    var ITF_1$1 = ITF.ITF14;
    var ITF_2 = ITF.ITF;

    var MSI_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation
    // https://en.wikipedia.org/wiki/MSI_Barcode#Character_set_and_binary_lookup

    var MSI = function (_Barcode) {
    	_inherits(MSI, _Barcode);

    	function MSI(data, options) {
    		_classCallCheck(this, MSI);

    		return _possibleConstructorReturn(this, (MSI.__proto__ || Object.getPrototypeOf(MSI)).call(this, data, options));
    	}

    	_createClass(MSI, [{
    		key: "encode",
    		value: function encode() {
    			// Start bits
    			var ret = "110";

    			for (var i = 0; i < this.data.length; i++) {
    				// Convert the character to binary (always 4 binary digits)
    				var digit = parseInt(this.data[i]);
    				var bin = digit.toString(2);
    				bin = addZeroes(bin, 4 - bin.length);

    				// Add 100 for every zero and 110 for every 1
    				for (var b = 0; b < bin.length; b++) {
    					ret += bin[b] == "0" ? "100" : "110";
    				}
    			}

    			// End bits
    			ret += "1001";

    			return {
    				data: ret,
    				text: this.text
    			};
    		}
    	}, {
    		key: "valid",
    		value: function valid() {
    			return this.data.search(/^[0-9]+$/) !== -1;
    		}
    	}]);

    	return MSI;
    }(_Barcode3.default);

    function addZeroes(number, n) {
    	for (var i = 0; i < n; i++) {
    		number = "0" + number;
    	}
    	return number;
    }

    exports.default = MSI;
    });

    unwrapExports(MSI_1);

    var checksums = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.mod10 = mod10;
    exports.mod11 = mod11;
    function mod10(number) {
    	var sum = 0;
    	for (var i = 0; i < number.length; i++) {
    		var n = parseInt(number[i]);
    		if ((i + number.length) % 2 === 0) {
    			sum += n;
    		} else {
    			sum += n * 2 % 10 + Math.floor(n * 2 / 10);
    		}
    	}
    	return (10 - sum % 10) % 10;
    }

    function mod11(number) {
    	var sum = 0;
    	var weights = [2, 3, 4, 5, 6, 7];
    	for (var i = 0; i < number.length; i++) {
    		var n = parseInt(number[number.length - 1 - i]);
    		sum += weights[i % weights.length] * n;
    	}
    	return (11 - sum % 11) % 11;
    }
    });

    unwrapExports(checksums);
    var checksums_1 = checksums.mod10;
    var checksums_2 = checksums.mod11;

    var MSI10_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    var _MSI3 = _interopRequireDefault(MSI_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var MSI10 = function (_MSI) {
    	_inherits(MSI10, _MSI);

    	function MSI10(data, options) {
    		_classCallCheck(this, MSI10);

    		return _possibleConstructorReturn(this, (MSI10.__proto__ || Object.getPrototypeOf(MSI10)).call(this, data + (0, checksums.mod10)(data), options));
    	}

    	return MSI10;
    }(_MSI3.default);

    exports.default = MSI10;
    });

    unwrapExports(MSI10_1);

    var MSI11_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    var _MSI3 = _interopRequireDefault(MSI_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var MSI11 = function (_MSI) {
    	_inherits(MSI11, _MSI);

    	function MSI11(data, options) {
    		_classCallCheck(this, MSI11);

    		return _possibleConstructorReturn(this, (MSI11.__proto__ || Object.getPrototypeOf(MSI11)).call(this, data + (0, checksums.mod11)(data), options));
    	}

    	return MSI11;
    }(_MSI3.default);

    exports.default = MSI11;
    });

    unwrapExports(MSI11_1);

    var MSI1010_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    var _MSI3 = _interopRequireDefault(MSI_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var MSI1010 = function (_MSI) {
    	_inherits(MSI1010, _MSI);

    	function MSI1010(data, options) {
    		_classCallCheck(this, MSI1010);

    		data += (0, checksums.mod10)(data);
    		data += (0, checksums.mod10)(data);
    		return _possibleConstructorReturn(this, (MSI1010.__proto__ || Object.getPrototypeOf(MSI1010)).call(this, data, options));
    	}

    	return MSI1010;
    }(_MSI3.default);

    exports.default = MSI1010;
    });

    unwrapExports(MSI1010_1);

    var MSI1110_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    var _MSI3 = _interopRequireDefault(MSI_1);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var MSI1110 = function (_MSI) {
    	_inherits(MSI1110, _MSI);

    	function MSI1110(data, options) {
    		_classCallCheck(this, MSI1110);

    		data += (0, checksums.mod11)(data);
    		data += (0, checksums.mod10)(data);
    		return _possibleConstructorReturn(this, (MSI1110.__proto__ || Object.getPrototypeOf(MSI1110)).call(this, data, options));
    	}

    	return MSI1110;
    }(_MSI3.default);

    exports.default = MSI1110;
    });

    unwrapExports(MSI1110_1);

    var MSI = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.MSI1110 = exports.MSI1010 = exports.MSI11 = exports.MSI10 = exports.MSI = undefined;



    var _MSI2 = _interopRequireDefault(MSI_1);



    var _MSI4 = _interopRequireDefault(MSI10_1);



    var _MSI6 = _interopRequireDefault(MSI11_1);



    var _MSI8 = _interopRequireDefault(MSI1010_1);



    var _MSI10 = _interopRequireDefault(MSI1110_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    exports.MSI = _MSI2.default;
    exports.MSI10 = _MSI4.default;
    exports.MSI11 = _MSI6.default;
    exports.MSI1010 = _MSI8.default;
    exports.MSI1110 = _MSI10.default;
    });

    unwrapExports(MSI);
    var MSI_1$1 = MSI.MSI1110;
    var MSI_2 = MSI.MSI1010;
    var MSI_3 = MSI.MSI11;
    var MSI_4 = MSI.MSI10;
    var MSI_5 = MSI.MSI;

    var pharmacode_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.pharmacode = undefined;

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding documentation
    // http://www.gomaro.ch/ftproot/Laetus_PHARMA-CODE.pdf

    var pharmacode = function (_Barcode) {
    	_inherits(pharmacode, _Barcode);

    	function pharmacode(data, options) {
    		_classCallCheck(this, pharmacode);

    		var _this = _possibleConstructorReturn(this, (pharmacode.__proto__ || Object.getPrototypeOf(pharmacode)).call(this, data, options));

    		_this.number = parseInt(data, 10);
    		return _this;
    	}

    	_createClass(pharmacode, [{
    		key: "encode",
    		value: function encode() {
    			var z = this.number;
    			var result = "";

    			// http://i.imgur.com/RMm4UDJ.png
    			// (source: http://www.gomaro.ch/ftproot/Laetus_PHARMA-CODE.pdf, page: 34)
    			while (!isNaN(z) && z != 0) {
    				if (z % 2 === 0) {
    					// Even
    					result = "11100" + result;
    					z = (z - 2) / 2;
    				} else {
    					// Odd
    					result = "100" + result;
    					z = (z - 1) / 2;
    				}
    			}

    			// Remove the two last zeroes
    			result = result.slice(0, -2);

    			return {
    				data: result,
    				text: this.text
    			};
    		}
    	}, {
    		key: "valid",
    		value: function valid() {
    			return this.number >= 3 && this.number <= 131070;
    		}
    	}]);

    	return pharmacode;
    }(_Barcode3.default);

    exports.pharmacode = pharmacode;
    });

    unwrapExports(pharmacode_1);
    var pharmacode_2 = pharmacode_1.pharmacode;

    var codabar_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.codabar = undefined;

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } // Encoding specification:
    // http://www.barcodeisland.com/codabar.phtml

    var codabar = function (_Barcode) {
    	_inherits(codabar, _Barcode);

    	function codabar(data, options) {
    		_classCallCheck(this, codabar);

    		if (data.search(/^[0-9\-\$\:\.\+\/]+$/) === 0) {
    			data = "A" + data + "A";
    		}

    		var _this = _possibleConstructorReturn(this, (codabar.__proto__ || Object.getPrototypeOf(codabar)).call(this, data.toUpperCase(), options));

    		_this.text = _this.options.text || _this.text.replace(/[A-D]/g, '');
    		return _this;
    	}

    	_createClass(codabar, [{
    		key: "valid",
    		value: function valid() {
    			return this.data.search(/^[A-D][0-9\-\$\:\.\+\/]+[A-D]$/) !== -1;
    		}
    	}, {
    		key: "encode",
    		value: function encode() {
    			var result = [];
    			var encodings = this.getEncodings();
    			for (var i = 0; i < this.data.length; i++) {
    				result.push(encodings[this.data.charAt(i)]);
    				// for all characters except the last, append a narrow-space ("0")
    				if (i !== this.data.length - 1) {
    					result.push("0");
    				}
    			}
    			return {
    				text: this.text,
    				data: result.join('')
    			};
    		}
    	}, {
    		key: "getEncodings",
    		value: function getEncodings() {
    			return {
    				"0": "101010011",
    				"1": "101011001",
    				"2": "101001011",
    				"3": "110010101",
    				"4": "101101001",
    				"5": "110101001",
    				"6": "100101011",
    				"7": "100101101",
    				"8": "100110101",
    				"9": "110100101",
    				"-": "101001101",
    				"$": "101100101",
    				":": "1101011011",
    				"/": "1101101011",
    				".": "1101101101",
    				"+": "101100110011",
    				"A": "1011001001",
    				"B": "1001001011",
    				"C": "1010010011",
    				"D": "1010011001"
    			};
    		}
    	}]);

    	return codabar;
    }(_Barcode3.default);

    exports.codabar = codabar;
    });

    unwrapExports(codabar_1);
    var codabar_2 = codabar_1.codabar;

    var GenericBarcode_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.GenericBarcode = undefined;

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _Barcode3 = _interopRequireDefault(Barcode_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var GenericBarcode = function (_Barcode) {
    	_inherits(GenericBarcode, _Barcode);

    	function GenericBarcode(data, options) {
    		_classCallCheck(this, GenericBarcode);

    		return _possibleConstructorReturn(this, (GenericBarcode.__proto__ || Object.getPrototypeOf(GenericBarcode)).call(this, data, options)); // Sets this.data and this.text
    	}

    	// Return the corresponding binary numbers for the data provided


    	_createClass(GenericBarcode, [{
    		key: "encode",
    		value: function encode() {
    			return {
    				data: "10101010101010101010101010101010101010101",
    				text: this.text
    			};
    		}

    		// Resturn true/false if the string provided is valid for this encoder

    	}, {
    		key: "valid",
    		value: function valid() {
    			return true;
    		}
    	}]);

    	return GenericBarcode;
    }(_Barcode3.default);

    exports.GenericBarcode = GenericBarcode;
    });

    unwrapExports(GenericBarcode_1);
    var GenericBarcode_2 = GenericBarcode_1.GenericBarcode;

    var barcodes = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

















    exports.default = {
    	CODE39: CODE39_1.CODE39,
    	CODE128: CODE128.CODE128, CODE128A: CODE128.CODE128A, CODE128B: CODE128.CODE128B, CODE128C: CODE128.CODE128C,
    	EAN13: EAN_UPC.EAN13, EAN8: EAN_UPC.EAN8, EAN5: EAN_UPC.EAN5, EAN2: EAN_UPC.EAN2, UPC: EAN_UPC.UPC, UPCE: EAN_UPC.UPCE,
    	ITF14: ITF.ITF14,
    	ITF: ITF.ITF,
    	MSI: MSI.MSI, MSI10: MSI.MSI10, MSI11: MSI.MSI11, MSI1010: MSI.MSI1010, MSI1110: MSI.MSI1110,
    	pharmacode: pharmacode_1.pharmacode,
    	codabar: codabar_1.codabar,
    	GenericBarcode: GenericBarcode_1.GenericBarcode
    };
    });

    unwrapExports(barcodes);

    var merge = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
      value: true
    });

    var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

    exports.default = function (old, replaceObj) {
      return _extends({}, old, replaceObj);
    };
    });

    unwrapExports(merge);

    var linearizeEncodings_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.default = linearizeEncodings;

    // Encodings can be nestled like [[1-1, 1-2], 2, [3-1, 3-2]
    // Convert to [1-1, 1-2, 2, 3-1, 3-2]

    function linearizeEncodings(encodings) {
    	var linearEncodings = [];
    	function nextLevel(encoded) {
    		if (Array.isArray(encoded)) {
    			for (var i = 0; i < encoded.length; i++) {
    				nextLevel(encoded[i]);
    			}
    		} else {
    			encoded.text = encoded.text || "";
    			encoded.data = encoded.data || "";
    			linearEncodings.push(encoded);
    		}
    	}
    	nextLevel(encodings);

    	return linearEncodings;
    }
    });

    unwrapExports(linearizeEncodings_1);

    var fixOptions_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.default = fixOptions;


    function fixOptions(options) {
    	// Fix the margins
    	options.marginTop = options.marginTop || options.margin;
    	options.marginBottom = options.marginBottom || options.margin;
    	options.marginRight = options.marginRight || options.margin;
    	options.marginLeft = options.marginLeft || options.margin;

    	return options;
    }
    });

    unwrapExports(fixOptions_1);

    var optionsFromStrings_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.default = optionsFromStrings;

    // Convert string to integers/booleans where it should be

    function optionsFromStrings(options) {
    	var intOptions = ["width", "height", "textMargin", "fontSize", "margin", "marginTop", "marginBottom", "marginLeft", "marginRight"];

    	for (var intOption in intOptions) {
    		if (intOptions.hasOwnProperty(intOption)) {
    			intOption = intOptions[intOption];
    			if (typeof options[intOption] === "string") {
    				options[intOption] = parseInt(options[intOption], 10);
    			}
    		}
    	}

    	if (typeof options["displayValue"] === "string") {
    		options["displayValue"] = options["displayValue"] != "false";
    	}

    	return options;
    }
    });

    unwrapExports(optionsFromStrings_1);

    var defaults_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    var defaults = {
    	width: 2,
    	height: 100,
    	format: "auto",
    	displayValue: true,
    	fontOptions: "",
    	font: "monospace",
    	text: undefined,
    	textAlign: "center",
    	textPosition: "bottom",
    	textMargin: 2,
    	fontSize: 20,
    	background: "#ffffff",
    	lineColor: "#000000",
    	margin: 10,
    	marginTop: undefined,
    	marginBottom: undefined,
    	marginLeft: undefined,
    	marginRight: undefined,
    	valid: function valid() {}
    };

    exports.default = defaults;
    });

    unwrapExports(defaults_1);

    var getOptionsFromElement_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });



    var _optionsFromStrings2 = _interopRequireDefault(optionsFromStrings_1);



    var _defaults2 = _interopRequireDefault(defaults_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function getOptionsFromElement(element) {
    	var options = {};
    	for (var property in _defaults2.default) {
    		if (_defaults2.default.hasOwnProperty(property)) {
    			// jsbarcode-*
    			if (element.hasAttribute("jsbarcode-" + property.toLowerCase())) {
    				options[property] = element.getAttribute("jsbarcode-" + property.toLowerCase());
    			}

    			// data-*
    			if (element.hasAttribute("data-" + property.toLowerCase())) {
    				options[property] = element.getAttribute("data-" + property.toLowerCase());
    			}
    		}
    	}

    	options["value"] = element.getAttribute("jsbarcode-value") || element.getAttribute("data-value");

    	// Since all atributes are string they need to be converted to integers
    	options = (0, _optionsFromStrings2.default)(options);

    	return options;
    }

    exports.default = getOptionsFromElement;
    });

    unwrapExports(getOptionsFromElement_1);

    var shared = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });
    exports.getTotalWidthOfEncodings = exports.calculateEncodingAttributes = exports.getBarcodePadding = exports.getEncodingHeight = exports.getMaximumHeightOfEncodings = undefined;



    var _merge2 = _interopRequireDefault(merge);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function getEncodingHeight(encoding, options) {
    	return options.height + (options.displayValue && encoding.text.length > 0 ? options.fontSize + options.textMargin : 0) + options.marginTop + options.marginBottom;
    }

    function getBarcodePadding(textWidth, barcodeWidth, options) {
    	if (options.displayValue && barcodeWidth < textWidth) {
    		if (options.textAlign == "center") {
    			return Math.floor((textWidth - barcodeWidth) / 2);
    		} else if (options.textAlign == "left") {
    			return 0;
    		} else if (options.textAlign == "right") {
    			return Math.floor(textWidth - barcodeWidth);
    		}
    	}
    	return 0;
    }

    function calculateEncodingAttributes(encodings, barcodeOptions, context) {
    	for (var i = 0; i < encodings.length; i++) {
    		var encoding = encodings[i];
    		var options = (0, _merge2.default)(barcodeOptions, encoding.options);

    		// Calculate the width of the encoding
    		var textWidth;
    		if (options.displayValue) {
    			textWidth = messureText(encoding.text, options, context);
    		} else {
    			textWidth = 0;
    		}

    		var barcodeWidth = encoding.data.length * options.width;
    		encoding.width = Math.ceil(Math.max(textWidth, barcodeWidth));

    		encoding.height = getEncodingHeight(encoding, options);

    		encoding.barcodePadding = getBarcodePadding(textWidth, barcodeWidth, options);
    	}
    }

    function getTotalWidthOfEncodings(encodings) {
    	var totalWidth = 0;
    	for (var i = 0; i < encodings.length; i++) {
    		totalWidth += encodings[i].width;
    	}
    	return totalWidth;
    }

    function getMaximumHeightOfEncodings(encodings) {
    	var maxHeight = 0;
    	for (var i = 0; i < encodings.length; i++) {
    		if (encodings[i].height > maxHeight) {
    			maxHeight = encodings[i].height;
    		}
    	}
    	return maxHeight;
    }

    function messureText(string, options, context) {
    	var ctx;

    	if (context) {
    		ctx = context;
    	} else if (typeof document !== "undefined") {
    		ctx = document.createElement("canvas").getContext("2d");
    	} else {
    		// If the text cannot be messured we will return 0.
    		// This will make some barcode with big text render incorrectly
    		return 0;
    	}
    	ctx.font = options.fontOptions + " " + options.fontSize + "px " + options.font;

    	// Calculate the width of the encoding
    	var measureTextResult = ctx.measureText(string);
    	if (!measureTextResult) {
    		// Some implementations don't implement measureText and return undefined.
    		// If the text cannot be measured we will return 0.
    		// This will make some barcode with big text render incorrectly
    		return 0;
    	}
    	var size = measureTextResult.width;
    	return size;
    }

    exports.getMaximumHeightOfEncodings = getMaximumHeightOfEncodings;
    exports.getEncodingHeight = getEncodingHeight;
    exports.getBarcodePadding = getBarcodePadding;
    exports.calculateEncodingAttributes = calculateEncodingAttributes;
    exports.getTotalWidthOfEncodings = getTotalWidthOfEncodings;
    });

    unwrapExports(shared);
    var shared_1 = shared.getTotalWidthOfEncodings;
    var shared_2 = shared.calculateEncodingAttributes;
    var shared_3 = shared.getBarcodePadding;
    var shared_4 = shared.getEncodingHeight;
    var shared_5 = shared.getMaximumHeightOfEncodings;

    var canvas = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _merge2 = _interopRequireDefault(merge);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    var CanvasRenderer = function () {
    	function CanvasRenderer(canvas, encodings, options) {
    		_classCallCheck(this, CanvasRenderer);

    		this.canvas = canvas;
    		this.encodings = encodings;
    		this.options = options;
    	}

    	_createClass(CanvasRenderer, [{
    		key: "render",
    		value: function render() {
    			// Abort if the browser does not support HTML5 canvas
    			if (!this.canvas.getContext) {
    				throw new Error('The browser does not support canvas.');
    			}

    			this.prepareCanvas();
    			for (var i = 0; i < this.encodings.length; i++) {
    				var encodingOptions = (0, _merge2.default)(this.options, this.encodings[i].options);

    				this.drawCanvasBarcode(encodingOptions, this.encodings[i]);
    				this.drawCanvasText(encodingOptions, this.encodings[i]);

    				this.moveCanvasDrawing(this.encodings[i]);
    			}

    			this.restoreCanvas();
    		}
    	}, {
    		key: "prepareCanvas",
    		value: function prepareCanvas() {
    			// Get the canvas context
    			var ctx = this.canvas.getContext("2d");

    			ctx.save();

    			(0, shared.calculateEncodingAttributes)(this.encodings, this.options, ctx);
    			var totalWidth = (0, shared.getTotalWidthOfEncodings)(this.encodings);
    			var maxHeight = (0, shared.getMaximumHeightOfEncodings)(this.encodings);

    			this.canvas.width = totalWidth + this.options.marginLeft + this.options.marginRight;

    			this.canvas.height = maxHeight;

    			// Paint the canvas
    			ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    			if (this.options.background) {
    				ctx.fillStyle = this.options.background;
    				ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    			}

    			ctx.translate(this.options.marginLeft, 0);
    		}
    	}, {
    		key: "drawCanvasBarcode",
    		value: function drawCanvasBarcode(options, encoding) {
    			// Get the canvas context
    			var ctx = this.canvas.getContext("2d");

    			var binary = encoding.data;

    			// Creates the barcode out of the encoded binary
    			var yFrom;
    			if (options.textPosition == "top") {
    				yFrom = options.marginTop + options.fontSize + options.textMargin;
    			} else {
    				yFrom = options.marginTop;
    			}

    			ctx.fillStyle = options.lineColor;

    			for (var b = 0; b < binary.length; b++) {
    				var x = b * options.width + encoding.barcodePadding;

    				if (binary[b] === "1") {
    					ctx.fillRect(x, yFrom, options.width, options.height);
    				} else if (binary[b]) {
    					ctx.fillRect(x, yFrom, options.width, options.height * binary[b]);
    				}
    			}
    		}
    	}, {
    		key: "drawCanvasText",
    		value: function drawCanvasText(options, encoding) {
    			// Get the canvas context
    			var ctx = this.canvas.getContext("2d");

    			var font = options.fontOptions + " " + options.fontSize + "px " + options.font;

    			// Draw the text if displayValue is set
    			if (options.displayValue) {
    				var x, y;

    				if (options.textPosition == "top") {
    					y = options.marginTop + options.fontSize - options.textMargin;
    				} else {
    					y = options.height + options.textMargin + options.marginTop + options.fontSize;
    				}

    				ctx.font = font;

    				// Draw the text in the correct X depending on the textAlign option
    				if (options.textAlign == "left" || encoding.barcodePadding > 0) {
    					x = 0;
    					ctx.textAlign = 'left';
    				} else if (options.textAlign == "right") {
    					x = encoding.width - 1;
    					ctx.textAlign = 'right';
    				}
    				// In all other cases, center the text
    				else {
    						x = encoding.width / 2;
    						ctx.textAlign = 'center';
    					}

    				ctx.fillText(encoding.text, x, y);
    			}
    		}
    	}, {
    		key: "moveCanvasDrawing",
    		value: function moveCanvasDrawing(encoding) {
    			var ctx = this.canvas.getContext("2d");

    			ctx.translate(encoding.width, 0);
    		}
    	}, {
    		key: "restoreCanvas",
    		value: function restoreCanvas() {
    			// Get the canvas context
    			var ctx = this.canvas.getContext("2d");

    			ctx.restore();
    		}
    	}]);

    	return CanvasRenderer;
    }();

    exports.default = CanvasRenderer;
    });

    unwrapExports(canvas);

    var svg = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



    var _merge2 = _interopRequireDefault(merge);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    var svgns = "http://www.w3.org/2000/svg";

    var SVGRenderer = function () {
    	function SVGRenderer(svg, encodings, options) {
    		_classCallCheck(this, SVGRenderer);

    		this.svg = svg;
    		this.encodings = encodings;
    		this.options = options;
    		this.document = options.xmlDocument || document;
    	}

    	_createClass(SVGRenderer, [{
    		key: "render",
    		value: function render() {
    			var currentX = this.options.marginLeft;

    			this.prepareSVG();
    			for (var i = 0; i < this.encodings.length; i++) {
    				var encoding = this.encodings[i];
    				var encodingOptions = (0, _merge2.default)(this.options, encoding.options);

    				var group = this.createGroup(currentX, encodingOptions.marginTop, this.svg);

    				this.setGroupOptions(group, encodingOptions);

    				this.drawSvgBarcode(group, encodingOptions, encoding);
    				this.drawSVGText(group, encodingOptions, encoding);

    				currentX += encoding.width;
    			}
    		}
    	}, {
    		key: "prepareSVG",
    		value: function prepareSVG() {
    			// Clear the SVG
    			while (this.svg.firstChild) {
    				this.svg.removeChild(this.svg.firstChild);
    			}

    			(0, shared.calculateEncodingAttributes)(this.encodings, this.options);
    			var totalWidth = (0, shared.getTotalWidthOfEncodings)(this.encodings);
    			var maxHeight = (0, shared.getMaximumHeightOfEncodings)(this.encodings);

    			var width = totalWidth + this.options.marginLeft + this.options.marginRight;
    			this.setSvgAttributes(width, maxHeight);

    			if (this.options.background) {
    				this.drawRect(0, 0, width, maxHeight, this.svg).setAttribute("style", "fill:" + this.options.background + ";");
    			}
    		}
    	}, {
    		key: "drawSvgBarcode",
    		value: function drawSvgBarcode(parent, options, encoding) {
    			var binary = encoding.data;

    			// Creates the barcode out of the encoded binary
    			var yFrom;
    			if (options.textPosition == "top") {
    				yFrom = options.fontSize + options.textMargin;
    			} else {
    				yFrom = 0;
    			}

    			var barWidth = 0;
    			var x = 0;
    			for (var b = 0; b < binary.length; b++) {
    				x = b * options.width + encoding.barcodePadding;

    				if (binary[b] === "1") {
    					barWidth++;
    				} else if (barWidth > 0) {
    					this.drawRect(x - options.width * barWidth, yFrom, options.width * barWidth, options.height, parent);
    					barWidth = 0;
    				}
    			}

    			// Last draw is needed since the barcode ends with 1
    			if (barWidth > 0) {
    				this.drawRect(x - options.width * (barWidth - 1), yFrom, options.width * barWidth, options.height, parent);
    			}
    		}
    	}, {
    		key: "drawSVGText",
    		value: function drawSVGText(parent, options, encoding) {
    			var textElem = this.document.createElementNS(svgns, 'text');

    			// Draw the text if displayValue is set
    			if (options.displayValue) {
    				var x, y;

    				textElem.setAttribute("style", "font:" + options.fontOptions + " " + options.fontSize + "px " + options.font);

    				if (options.textPosition == "top") {
    					y = options.fontSize - options.textMargin;
    				} else {
    					y = options.height + options.textMargin + options.fontSize;
    				}

    				// Draw the text in the correct X depending on the textAlign option
    				if (options.textAlign == "left" || encoding.barcodePadding > 0) {
    					x = 0;
    					textElem.setAttribute("text-anchor", "start");
    				} else if (options.textAlign == "right") {
    					x = encoding.width - 1;
    					textElem.setAttribute("text-anchor", "end");
    				}
    				// In all other cases, center the text
    				else {
    						x = encoding.width / 2;
    						textElem.setAttribute("text-anchor", "middle");
    					}

    				textElem.setAttribute("x", x);
    				textElem.setAttribute("y", y);

    				textElem.appendChild(this.document.createTextNode(encoding.text));

    				parent.appendChild(textElem);
    			}
    		}
    	}, {
    		key: "setSvgAttributes",
    		value: function setSvgAttributes(width, height) {
    			var svg = this.svg;
    			svg.setAttribute("width", width + "px");
    			svg.setAttribute("height", height + "px");
    			svg.setAttribute("x", "0px");
    			svg.setAttribute("y", "0px");
    			svg.setAttribute("viewBox", "0 0 " + width + " " + height);

    			svg.setAttribute("xmlns", svgns);
    			svg.setAttribute("version", "1.1");

    			svg.setAttribute("style", "transform: translate(0,0)");
    		}
    	}, {
    		key: "createGroup",
    		value: function createGroup(x, y, parent) {
    			var group = this.document.createElementNS(svgns, 'g');
    			group.setAttribute("transform", "translate(" + x + ", " + y + ")");

    			parent.appendChild(group);

    			return group;
    		}
    	}, {
    		key: "setGroupOptions",
    		value: function setGroupOptions(group, options) {
    			group.setAttribute("style", "fill:" + options.lineColor + ";");
    		}
    	}, {
    		key: "drawRect",
    		value: function drawRect(x, y, width, height, parent) {
    			var rect = this.document.createElementNS(svgns, 'rect');

    			rect.setAttribute("x", x);
    			rect.setAttribute("y", y);
    			rect.setAttribute("width", width);
    			rect.setAttribute("height", height);

    			parent.appendChild(rect);

    			return rect;
    		}
    	}]);

    	return SVGRenderer;
    }();

    exports.default = SVGRenderer;
    });

    unwrapExports(svg);

    var object = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    var ObjectRenderer = function () {
    	function ObjectRenderer(object, encodings, options) {
    		_classCallCheck(this, ObjectRenderer);

    		this.object = object;
    		this.encodings = encodings;
    		this.options = options;
    	}

    	_createClass(ObjectRenderer, [{
    		key: "render",
    		value: function render() {
    			this.object.encodings = this.encodings;
    		}
    	}]);

    	return ObjectRenderer;
    }();

    exports.default = ObjectRenderer;
    });

    unwrapExports(object);

    var renderers = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
      value: true
    });



    var _canvas2 = _interopRequireDefault(canvas);



    var _svg2 = _interopRequireDefault(svg);



    var _object2 = _interopRequireDefault(object);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    exports.default = { CanvasRenderer: _canvas2.default, SVGRenderer: _svg2.default, ObjectRenderer: _object2.default };
    });

    unwrapExports(renderers);

    var exceptions = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

    function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

    var InvalidInputException = function (_Error) {
    	_inherits(InvalidInputException, _Error);

    	function InvalidInputException(symbology, input) {
    		_classCallCheck(this, InvalidInputException);

    		var _this = _possibleConstructorReturn(this, (InvalidInputException.__proto__ || Object.getPrototypeOf(InvalidInputException)).call(this));

    		_this.name = "InvalidInputException";

    		_this.symbology = symbology;
    		_this.input = input;

    		_this.message = '"' + _this.input + '" is not a valid input for ' + _this.symbology;
    		return _this;
    	}

    	return InvalidInputException;
    }(Error);

    var InvalidElementException = function (_Error2) {
    	_inherits(InvalidElementException, _Error2);

    	function InvalidElementException() {
    		_classCallCheck(this, InvalidElementException);

    		var _this2 = _possibleConstructorReturn(this, (InvalidElementException.__proto__ || Object.getPrototypeOf(InvalidElementException)).call(this));

    		_this2.name = "InvalidElementException";
    		_this2.message = "Not supported type to render on";
    		return _this2;
    	}

    	return InvalidElementException;
    }(Error);

    var NoElementException = function (_Error3) {
    	_inherits(NoElementException, _Error3);

    	function NoElementException() {
    		_classCallCheck(this, NoElementException);

    		var _this3 = _possibleConstructorReturn(this, (NoElementException.__proto__ || Object.getPrototypeOf(NoElementException)).call(this));

    		_this3.name = "NoElementException";
    		_this3.message = "No element to render on.";
    		return _this3;
    	}

    	return NoElementException;
    }(Error);

    exports.InvalidInputException = InvalidInputException;
    exports.InvalidElementException = InvalidElementException;
    exports.NoElementException = NoElementException;
    });

    unwrapExports(exceptions);
    var exceptions_1 = exceptions.InvalidInputException;
    var exceptions_2 = exceptions.InvalidElementException;
    var exceptions_3 = exceptions.NoElementException;

    var getRenderProperties_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; /* global HTMLImageElement */
    /* global HTMLCanvasElement */
    /* global SVGElement */



    var _getOptionsFromElement2 = _interopRequireDefault(getOptionsFromElement_1);



    var _renderers2 = _interopRequireDefault(renderers);



    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    // Takes an element and returns an object with information about how
    // it should be rendered
    // This could also return an array with these objects
    // {
    //   element: The element that the renderer should draw on
    //   renderer: The name of the renderer
    //   afterRender (optional): If something has to done after the renderer
    //     completed, calls afterRender (function)
    //   options (optional): Options that can be defined in the element
    // }

    function getRenderProperties(element) {
    	// If the element is a string, query select call again
    	if (typeof element === "string") {
    		return querySelectedRenderProperties(element);
    	}
    	// If element is array. Recursivly call with every object in the array
    	else if (Array.isArray(element)) {
    			var returnArray = [];
    			for (var i = 0; i < element.length; i++) {
    				returnArray.push(getRenderProperties(element[i]));
    			}
    			return returnArray;
    		}
    		// If element, render on canvas and set the uri as src
    		else if (typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLImageElement) {
    				return newCanvasRenderProperties(element);
    			}
    			// If SVG
    			else if (element && element.nodeName && element.nodeName.toLowerCase() === 'svg' || typeof SVGElement !== 'undefined' && element instanceof SVGElement) {
    					return {
    						element: element,
    						options: (0, _getOptionsFromElement2.default)(element),
    						renderer: _renderers2.default.SVGRenderer
    					};
    				}
    				// If canvas (in browser)
    				else if (typeof HTMLCanvasElement !== 'undefined' && element instanceof HTMLCanvasElement) {
    						return {
    							element: element,
    							options: (0, _getOptionsFromElement2.default)(element),
    							renderer: _renderers2.default.CanvasRenderer
    						};
    					}
    					// If canvas (in node)
    					else if (element && element.getContext) {
    							return {
    								element: element,
    								renderer: _renderers2.default.CanvasRenderer
    							};
    						} else if (element && (typeof element === "undefined" ? "undefined" : _typeof(element)) === 'object' && !element.nodeName) {
    							return {
    								element: element,
    								renderer: _renderers2.default.ObjectRenderer
    							};
    						} else {
    							throw new exceptions.InvalidElementException();
    						}
    }

    function querySelectedRenderProperties(string) {
    	var selector = document.querySelectorAll(string);
    	if (selector.length === 0) {
    		return undefined;
    	} else {
    		var returnArray = [];
    		for (var i = 0; i < selector.length; i++) {
    			returnArray.push(getRenderProperties(selector[i]));
    		}
    		return returnArray;
    	}
    }

    function newCanvasRenderProperties(imgElement) {
    	var canvas = document.createElement('canvas');
    	return {
    		element: canvas,
    		options: (0, _getOptionsFromElement2.default)(imgElement),
    		renderer: _renderers2.default.CanvasRenderer,
    		afterRender: function afterRender() {
    			imgElement.setAttribute("src", canvas.toDataURL());
    		}
    	};
    }

    exports.default = getRenderProperties;
    });

    unwrapExports(getRenderProperties_1);

    var ErrorHandler_1 = createCommonjsModule(function (module, exports) {

    Object.defineProperty(exports, "__esModule", {
    	value: true
    });

    var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    /*eslint no-console: 0 */

    var ErrorHandler = function () {
    	function ErrorHandler(api) {
    		_classCallCheck(this, ErrorHandler);

    		this.api = api;
    	}

    	_createClass(ErrorHandler, [{
    		key: "handleCatch",
    		value: function handleCatch(e) {
    			// If babel supported extending of Error in a correct way instanceof would be used here
    			if (e.name === "InvalidInputException") {
    				if (this.api._options.valid !== this.api._defaults.valid) {
    					this.api._options.valid(false);
    				} else {
    					throw e.message;
    				}
    			} else {
    				throw e;
    			}

    			this.api.render = function () {};
    		}
    	}, {
    		key: "wrapBarcodeCall",
    		value: function wrapBarcodeCall(func) {
    			try {
    				var result = func.apply(undefined, arguments);
    				this.api._options.valid(true);
    				return result;
    			} catch (e) {
    				this.handleCatch(e);

    				return this.api;
    			}
    		}
    	}]);

    	return ErrorHandler;
    }();

    exports.default = ErrorHandler;
    });

    unwrapExports(ErrorHandler_1);

    var JsBarcode_1 = createCommonjsModule(function (module) {



    var _barcodes2 = _interopRequireDefault(barcodes);



    var _merge2 = _interopRequireDefault(merge);



    var _linearizeEncodings2 = _interopRequireDefault(linearizeEncodings_1);



    var _fixOptions2 = _interopRequireDefault(fixOptions_1);



    var _getRenderProperties2 = _interopRequireDefault(getRenderProperties_1);



    var _optionsFromStrings2 = _interopRequireDefault(optionsFromStrings_1);



    var _ErrorHandler2 = _interopRequireDefault(ErrorHandler_1);





    var _defaults2 = _interopRequireDefault(defaults_1);

    function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

    // The protype of the object returned from the JsBarcode() call


    // Help functions
    var API = function API() {};

    // The first call of the library API
    // Will return an object with all barcodes calls and the data that is used
    // by the renderers


    // Default values


    // Exceptions
    // Import all the barcodes
    var JsBarcode = function JsBarcode(element, text, options) {
    	var api = new API();

    	if (typeof element === "undefined") {
    		throw Error("No element to render on was provided.");
    	}

    	// Variables that will be pased through the API calls
    	api._renderProperties = (0, _getRenderProperties2.default)(element);
    	api._encodings = [];
    	api._options = _defaults2.default;
    	api._errorHandler = new _ErrorHandler2.default(api);

    	// If text is set, use the simple syntax (render the barcode directly)
    	if (typeof text !== "undefined") {
    		options = options || {};

    		if (!options.format) {
    			options.format = autoSelectBarcode();
    		}

    		api.options(options)[options.format](text, options).render();
    	}

    	return api;
    };

    // To make tests work TODO: remove
    JsBarcode.getModule = function (name) {
    	return _barcodes2.default[name];
    };

    // Register all barcodes
    for (var name in _barcodes2.default) {
    	if (_barcodes2.default.hasOwnProperty(name)) {
    		// Security check if the propery is a prototype property
    		registerBarcode(_barcodes2.default, name);
    	}
    }
    function registerBarcode(barcodes, name) {
    	API.prototype[name] = API.prototype[name.toUpperCase()] = API.prototype[name.toLowerCase()] = function (text, options) {
    		var api = this;
    		return api._errorHandler.wrapBarcodeCall(function () {
    			// Ensure text is options.text
    			options.text = typeof options.text === 'undefined' ? undefined : '' + options.text;

    			var newOptions = (0, _merge2.default)(api._options, options);
    			newOptions = (0, _optionsFromStrings2.default)(newOptions);
    			var Encoder = barcodes[name];
    			var encoded = encode(text, Encoder, newOptions);
    			api._encodings.push(encoded);

    			return api;
    		});
    	};
    }

    // encode() handles the Encoder call and builds the binary string to be rendered
    function encode(text, Encoder, options) {
    	// Ensure that text is a string
    	text = "" + text;

    	var encoder = new Encoder(text, options);

    	// If the input is not valid for the encoder, throw error.
    	// If the valid callback option is set, call it instead of throwing error
    	if (!encoder.valid()) {
    		throw new exceptions.InvalidInputException(encoder.constructor.name, text);
    	}

    	// Make a request for the binary data (and other infromation) that should be rendered
    	var encoded = encoder.encode();

    	// Encodings can be nestled like [[1-1, 1-2], 2, [3-1, 3-2]
    	// Convert to [1-1, 1-2, 2, 3-1, 3-2]
    	encoded = (0, _linearizeEncodings2.default)(encoded);

    	// Merge
    	for (var i = 0; i < encoded.length; i++) {
    		encoded[i].options = (0, _merge2.default)(options, encoded[i].options);
    	}

    	return encoded;
    }

    function autoSelectBarcode() {
    	// If CODE128 exists. Use it
    	if (_barcodes2.default["CODE128"]) {
    		return "CODE128";
    	}

    	// Else, take the first (probably only) barcode
    	return Object.keys(_barcodes2.default)[0];
    }

    // Sets global encoder options
    // Added to the api by the JsBarcode function
    API.prototype.options = function (options) {
    	this._options = (0, _merge2.default)(this._options, options);
    	return this;
    };

    // Will create a blank space (usually in between barcodes)
    API.prototype.blank = function (size) {
    	var zeroes = new Array(size + 1).join("0");
    	this._encodings.push({ data: zeroes });
    	return this;
    };

    // Initialize JsBarcode on all HTML elements defined.
    API.prototype.init = function () {
    	// Should do nothing if no elements where found
    	if (!this._renderProperties) {
    		return;
    	}

    	// Make sure renderProperies is an array
    	if (!Array.isArray(this._renderProperties)) {
    		this._renderProperties = [this._renderProperties];
    	}

    	var renderProperty;
    	for (var i in this._renderProperties) {
    		renderProperty = this._renderProperties[i];
    		var options = (0, _merge2.default)(this._options, renderProperty.options);

    		if (options.format == "auto") {
    			options.format = autoSelectBarcode();
    		}

    		this._errorHandler.wrapBarcodeCall(function () {
    			var text = options.value;
    			var Encoder = _barcodes2.default[options.format.toUpperCase()];
    			var encoded = encode(text, Encoder, options);

    			render(renderProperty, encoded, options);
    		});
    	}
    };

    // The render API call. Calls the real render function.
    API.prototype.render = function () {
    	if (!this._renderProperties) {
    		throw new exceptions.NoElementException();
    	}

    	if (Array.isArray(this._renderProperties)) {
    		for (var i = 0; i < this._renderProperties.length; i++) {
    			render(this._renderProperties[i], this._encodings, this._options);
    		}
    	} else {
    		render(this._renderProperties, this._encodings, this._options);
    	}

    	return this;
    };

    API.prototype._defaults = _defaults2.default;

    // Prepares the encodings and calls the renderer
    function render(renderProperties, encodings, options) {
    	encodings = (0, _linearizeEncodings2.default)(encodings);

    	for (var i = 0; i < encodings.length; i++) {
    		encodings[i].options = (0, _merge2.default)(options, encodings[i].options);
    		(0, _fixOptions2.default)(encodings[i].options);
    	}

    	(0, _fixOptions2.default)(options);

    	var Renderer = renderProperties.renderer;
    	var renderer = new Renderer(renderProperties.element, encodings, options);
    	renderer.render();

    	if (renderProperties.afterRender) {
    		renderProperties.afterRender();
    	}
    }

    // Export to browser
    if (typeof window !== "undefined") {
    	window.JsBarcode = JsBarcode;
    }

    // Export to jQuery
    /*global jQuery */
    if (typeof jQuery !== 'undefined') {
    	jQuery.fn.JsBarcode = function (content, options) {
    		var elementArray = [];
    		jQuery(this).each(function () {
    			elementArray.push(this);
    		});
    		return JsBarcode(elementArray, content, options);
    	};
    }

    // Export to commonJS
    module.exports = JsBarcode;
    });

    var JsBarcode = unwrapExports(JsBarcode_1);

    /* home/bunlong/workspace/os/svelte-barcode/svelte-barcode/src/Barcode.svelte generated by Svelte v3.38.1 */
    const file = "home/bunlong/workspace/os/svelte-barcode/svelte-barcode/src/Barcode.svelte";

    // (57:0) {:else}
    function create_else_block(ctx) {
    	let svg;

    	const block = {
    		c: function create() {
    			svg = svg_element("svg");
    			add_location$1(svg, file, 57, 2, 1320);
    		},
    		m: function mount(target, anchor) {
    			insert_dev$1(target, svg, anchor);
    			/*svg_binding*/ ctx[24](svg);
    		},
    		p: noop$1,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev$1(svg);
    			/*svg_binding*/ ctx[24](null);
    		}
    	};

    	dispatch_dev$1("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(57:0) {:else}",
    		ctx
    	});

    	return block;
    }

    // (55:34) 
    function create_if_block_1(ctx) {
    	let canvas;

    	const block = {
    		c: function create() {
    			canvas = element$1("canvas");
    			add_location$1(canvas, file, 55, 2, 1272);
    		},
    		m: function mount(target, anchor) {
    			insert_dev$1(target, canvas, anchor);
    			/*canvas_binding*/ ctx[23](canvas);
    		},
    		p: noop$1,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev$1(canvas);
    			/*canvas_binding*/ ctx[23](null);
    		}
    	};

    	dispatch_dev$1("SvelteRegisterBlock", {
    		block,
    		id: create_if_block_1.name,
    		type: "if",
    		source: "(55:34) ",
    		ctx
    	});

    	return block;
    }

    // (53:0) {#if elementTag === 'img'}
    function create_if_block(ctx) {
    	let img;

    	const block = {
    		c: function create() {
    			img = element$1("img");
    			attr_dev$1(img, "alt", "");
    			add_location$1(img, file, 53, 2, 1200);
    		},
    		m: function mount(target, anchor) {
    			insert_dev$1(target, img, anchor);
    			/*img_binding*/ ctx[22](img);
    		},
    		p: noop$1,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev$1(img);
    			/*img_binding*/ ctx[22](null);
    		}
    	};

    	dispatch_dev$1("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(53:0) {#if elementTag === 'img'}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let if_block_anchor;

    	function select_block_type(ctx, dirty) {
    		if (/*elementTag*/ ctx[0] === "img") return create_if_block;
    		if (/*elementTag*/ ctx[0] === "canvas") return create_if_block_1;
    		return create_else_block;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type(ctx);

    	const block = {
    		c: function create() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			if_block.m(target, anchor);
    			insert_dev$1(target, if_block_anchor, anchor);
    		},
    		p: function update(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if_block.d(1);
    				if_block = current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			}
    		},
    		i: noop$1,
    		o: noop$1,
    		d: function destroy(detaching) {
    			if_block.d(detaching);
    			if (detaching) detach_dev$1(if_block_anchor);
    		}
    	};

    	dispatch_dev$1("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots$1("Barcode", slots, []);
    	let barcode;
    	let { value } = $$props;
    	let { elementTag = "img" } = $$props;
    	let { format = "CODE128" } = $$props;
    	let { width = 2 } = $$props;
    	let { height = 100 } = $$props;
    	let { displayValue = true } = $$props;
    	let { text = undefined } = $$props;
    	let { fontOptions = "" } = $$props;
    	let { font = "monospace" } = $$props;
    	let { textAlign = "center" } = $$props;
    	let { textPosition = "bottom" } = $$props;
    	let { textMargin = 2 } = $$props;
    	let { fontSize = 20 } = $$props;
    	let { background = "#ffffff" } = $$props;
    	let { lineColor = "#000000" } = $$props;
    	let { margin = 10 } = $$props;
    	let { marginTop = undefined } = $$props;
    	let { marginBottom = undefined } = $$props;
    	let { marginLeft = undefined } = $$props;
    	let { marginRight = undefined } = $$props;
    	let { flat = false } = $$props;

    	const options = {
    		format,
    		width,
    		height,
    		displayValue,
    		text,
    		fontOptions,
    		font,
    		textAlign,
    		textPosition,
    		textMargin,
    		fontSize,
    		background,
    		lineColor,
    		margin,
    		marginTop,
    		marginBottom,
    		marginLeft,
    		marginRight,
    		flat
    	};

    	onMount(async () => {
    		await tick();
    		JsBarcode(barcode, value, options);
    	});

    	const writable_props = [
    		"value",
    		"elementTag",
    		"format",
    		"width",
    		"height",
    		"displayValue",
    		"text",
    		"fontOptions",
    		"font",
    		"textAlign",
    		"textPosition",
    		"textMargin",
    		"fontSize",
    		"background",
    		"lineColor",
    		"margin",
    		"marginTop",
    		"marginBottom",
    		"marginLeft",
    		"marginRight",
    		"flat"
    	];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<Barcode> was created with unknown prop '${key}'`);
    	});

    	function img_binding($$value) {
    		binding_callbacks$1[$$value ? "unshift" : "push"](() => {
    			barcode = $$value;
    			$$invalidate(1, barcode);
    		});
    	}

    	function canvas_binding($$value) {
    		binding_callbacks$1[$$value ? "unshift" : "push"](() => {
    			barcode = $$value;
    			$$invalidate(1, barcode);
    		});
    	}

    	function svg_binding($$value) {
    		binding_callbacks$1[$$value ? "unshift" : "push"](() => {
    			barcode = $$value;
    			$$invalidate(1, barcode);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ("value" in $$props) $$invalidate(2, value = $$props.value);
    		if ("elementTag" in $$props) $$invalidate(0, elementTag = $$props.elementTag);
    		if ("format" in $$props) $$invalidate(3, format = $$props.format);
    		if ("width" in $$props) $$invalidate(4, width = $$props.width);
    		if ("height" in $$props) $$invalidate(5, height = $$props.height);
    		if ("displayValue" in $$props) $$invalidate(6, displayValue = $$props.displayValue);
    		if ("text" in $$props) $$invalidate(7, text = $$props.text);
    		if ("fontOptions" in $$props) $$invalidate(8, fontOptions = $$props.fontOptions);
    		if ("font" in $$props) $$invalidate(9, font = $$props.font);
    		if ("textAlign" in $$props) $$invalidate(10, textAlign = $$props.textAlign);
    		if ("textPosition" in $$props) $$invalidate(11, textPosition = $$props.textPosition);
    		if ("textMargin" in $$props) $$invalidate(12, textMargin = $$props.textMargin);
    		if ("fontSize" in $$props) $$invalidate(13, fontSize = $$props.fontSize);
    		if ("background" in $$props) $$invalidate(14, background = $$props.background);
    		if ("lineColor" in $$props) $$invalidate(15, lineColor = $$props.lineColor);
    		if ("margin" in $$props) $$invalidate(16, margin = $$props.margin);
    		if ("marginTop" in $$props) $$invalidate(17, marginTop = $$props.marginTop);
    		if ("marginBottom" in $$props) $$invalidate(18, marginBottom = $$props.marginBottom);
    		if ("marginLeft" in $$props) $$invalidate(19, marginLeft = $$props.marginLeft);
    		if ("marginRight" in $$props) $$invalidate(20, marginRight = $$props.marginRight);
    		if ("flat" in $$props) $$invalidate(21, flat = $$props.flat);
    	};

    	$$self.$capture_state = () => ({
    		onMount,
    		tick,
    		JsBarcode,
    		barcode,
    		value,
    		elementTag,
    		format,
    		width,
    		height,
    		displayValue,
    		text,
    		fontOptions,
    		font,
    		textAlign,
    		textPosition,
    		textMargin,
    		fontSize,
    		background,
    		lineColor,
    		margin,
    		marginTop,
    		marginBottom,
    		marginLeft,
    		marginRight,
    		flat,
    		options
    	});

    	$$self.$inject_state = $$props => {
    		if ("barcode" in $$props) $$invalidate(1, barcode = $$props.barcode);
    		if ("value" in $$props) $$invalidate(2, value = $$props.value);
    		if ("elementTag" in $$props) $$invalidate(0, elementTag = $$props.elementTag);
    		if ("format" in $$props) $$invalidate(3, format = $$props.format);
    		if ("width" in $$props) $$invalidate(4, width = $$props.width);
    		if ("height" in $$props) $$invalidate(5, height = $$props.height);
    		if ("displayValue" in $$props) $$invalidate(6, displayValue = $$props.displayValue);
    		if ("text" in $$props) $$invalidate(7, text = $$props.text);
    		if ("fontOptions" in $$props) $$invalidate(8, fontOptions = $$props.fontOptions);
    		if ("font" in $$props) $$invalidate(9, font = $$props.font);
    		if ("textAlign" in $$props) $$invalidate(10, textAlign = $$props.textAlign);
    		if ("textPosition" in $$props) $$invalidate(11, textPosition = $$props.textPosition);
    		if ("textMargin" in $$props) $$invalidate(12, textMargin = $$props.textMargin);
    		if ("fontSize" in $$props) $$invalidate(13, fontSize = $$props.fontSize);
    		if ("background" in $$props) $$invalidate(14, background = $$props.background);
    		if ("lineColor" in $$props) $$invalidate(15, lineColor = $$props.lineColor);
    		if ("margin" in $$props) $$invalidate(16, margin = $$props.margin);
    		if ("marginTop" in $$props) $$invalidate(17, marginTop = $$props.marginTop);
    		if ("marginBottom" in $$props) $$invalidate(18, marginBottom = $$props.marginBottom);
    		if ("marginLeft" in $$props) $$invalidate(19, marginLeft = $$props.marginLeft);
    		if ("marginRight" in $$props) $$invalidate(20, marginRight = $$props.marginRight);
    		if ("flat" in $$props) $$invalidate(21, flat = $$props.flat);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [
    		elementTag,
    		barcode,
    		value,
    		format,
    		width,
    		height,
    		displayValue,
    		text,
    		fontOptions,
    		font,
    		textAlign,
    		textPosition,
    		textMargin,
    		fontSize,
    		background,
    		lineColor,
    		margin,
    		marginTop,
    		marginBottom,
    		marginLeft,
    		marginRight,
    		flat,
    		img_binding,
    		canvas_binding,
    		svg_binding
    	];
    }

    class Barcode extends SvelteComponentDev$1 {
    	constructor(options) {
    		super(options);

    		init$1(this, options, instance, create_fragment, safe_not_equal$1, {
    			value: 2,
    			elementTag: 0,
    			format: 3,
    			width: 4,
    			height: 5,
    			displayValue: 6,
    			text: 7,
    			fontOptions: 8,
    			font: 9,
    			textAlign: 10,
    			textPosition: 11,
    			textMargin: 12,
    			fontSize: 13,
    			background: 14,
    			lineColor: 15,
    			margin: 16,
    			marginTop: 17,
    			marginBottom: 18,
    			marginLeft: 19,
    			marginRight: 20,
    			flat: 21
    		});

    		dispatch_dev$1("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Barcode",
    			options,
    			id: create_fragment.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*value*/ ctx[2] === undefined && !("value" in props)) {
    			console.warn("<Barcode> was created without expected prop 'value'");
    		}
    	}

    	get value() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set value(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get elementTag() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set elementTag(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get format() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set format(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get width() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set width(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get height() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set height(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get displayValue() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set displayValue(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get text() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set text(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get fontOptions() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set fontOptions(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get font() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set font(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get textAlign() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set textAlign(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get textPosition() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set textPosition(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get textMargin() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set textMargin(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get fontSize() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set fontSize(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get background() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set background(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get lineColor() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set lineColor(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get margin() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set margin(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get marginTop() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set marginTop(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get marginBottom() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set marginBottom(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get marginLeft() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set marginLeft(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get marginRight() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set marginRight(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get flat() {
    		throw new Error("<Barcode>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set flat(value) {
    		throw new Error("<Barcode>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* App.svelte generated by Svelte v3.38.1 */
    const file$1 = "App.svelte";

    function create_fragment$1(ctx) {
    	let main;
    	let barcode;
    	let current;

    	barcode = new Barcode({
    			props: {
    				value: "svelte-barcode",
    				elementTag: "canvas"
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			main = element("main");
    			create_component(barcode.$$.fragment);
    			attr_dev(main, "class", "svelte-1na4wt1");
    			add_location(main, file$1, 11, 0, 144);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			mount_component(barcode, main, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(barcode.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(barcode.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(barcode);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("App", slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Barcode });
    	return [];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    const app = new App({
      target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
