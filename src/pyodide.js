var languagePluginLoader = new Promise((resolve, reject) => {
    const baseURL = '{{DEPLOY}}';

    const packages = {
        'dateutil': [],
        'matplotlib': ['numpy', 'dateutil', 'pytz'],
        'numpy': [],
        'pandas': ['numpy', 'dateutil', 'pytz'],
        'pytz': [],
    };
    let loadedPackages = new Set();
    let loadPackage = (names) => {
        if (Array.isArray(names)) {
            names = [names];
        }

        // DFS to find all dependencies of the requested packages
        let queue = new Array(names);
        let toLoad = new Set();
        while (queue.length) {
            const package = queue.pop();
            if (!packages.hasOwnProperty(package)) {
                throw `Unknown package '${package}'`;
            }
            if (!loadedPackages.has(package)) {
                toLoad.add(package);
                packages[package].forEach((subpackage) => {
                    if (!loadedPackages.has(subpackage) &&
                        !toLoad.has(subpackage)) {
                        queue.push(subpackage);
                    }
                });
            }
        }

        let promise = new Promise((resolve, reject) => {
            if (toLoad.size === 0) {
                resolve('No new packages to load');
            }

            pyodide.monitorRunDependencies = (n) => {
                if (n === 0) {
                    loadedPackages.add.apply(loadedPackages, toLoad);
                    delete pyodide.monitorRunDependencies;
                    const packageList = Array.from(toLoad.keys()).join(', ');
                    resolve(`Loaded ${packageList}`);
                }
            };

            toLoad.forEach((package) => {
                let script = document.createElement('script');
                script.src = `${baseURL}${package}.js`;
                script.onerror = (e) => {
                    reject(e);
                };
                document.body.appendChild(script);
            });

            // We have to invalidate Python's import caches, or it won't
            // see the new files. This is done here so it happens in parallel
            // with the fetching over the network.
            window.pyodide.runPython(
                'import importlib as _importlib\n' +
                    '_importlib.invalidate_caches()\n');
        });

        return promise;
    };

    let makeCallableProxy = (obj) => {
        var clone = obj.clone();
        function callProxy(args) {
            return clone.call(Array.from(arguments), {});
        };
        return callProxy;
    };

    let wasmURL = `${baseURL}pyodide.asm.wasm`;
    let Module = {};
    window.Module = Module;

    let wasm_promise = WebAssembly.compileStreaming(fetch(wasmURL));
    Module.instantiateWasm = (info, receiveInstance) => {
        wasm_promise
            .then(module => WebAssembly.instantiate(module, info))
            .then(instance => receiveInstance(instance));
        return {};
    };
    Module.filePackagePrefixURL = baseURL;
    Module.postRun = () => {
        delete window.Module;
        resolve();
    };

    let data_script = document.createElement('script');
    data_script.src = `${baseURL}pyodide.asm.data.js`;
    data_script.onload = (event) => {
        let script = document.createElement('script');
        script.src = `${baseURL}pyodide.asm.js`;
        script.onload = () => {
            window.pyodide = pyodide(Module);
            window.pyodide.loadPackage = loadPackage;
            window.pyodide.makeCallableProxy = makeCallableProxy;
        };
        document.head.appendChild(script);
    };

    document.head.appendChild(data_script);

    if (window.iodide !== undefined) {
        // Load the custom CSS for Pyodide
        let link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        link.href = `${baseURL}renderedhtml.css`;
        document.getElementsByTagName('head')[0].appendChild(link);

        // Add a custom output handler for Python objects
        window.iodide.addOutputHandler({
            shouldHandle: (val) => {
                return (typeof val === 'object' &&
                        val['$$'] !== undefined &&
                        val['$$']['ptrType']['name'] === 'PyObject*');
            },

            render: (val) => {
                let div = document.createElement('div');
                div.className = 'rendered_html';
                var element;
                if ('_repr_html_' in val) {
                    let result = val._repr_html_();
                    if (typeof result === 'string') {
                        div.appendChild(new DOMParser().parseFromString(
                            result, 'text/html').body.firstChild);
                        element = div;
                    } else {
                        element = result;
                    }
                } else {
                    let pre = document.createElement('pre');
                    pre.textContent = window.pyodide.repr(val);
                    div.appendChild(pre);
                    element = div;
                }
                return element;
            }
        });
    }
});
languagePluginLoader
