var fs = require("fs");
var dir = require("node-dir");
var deasync = require("deasync");
var filesSync = deasync(dir.files);
var subdirSync = deasync(dir.subdirs);
var _ = require("lodash");
var Web3 = require("web3");
var loadconf = deasync(require("./loadconf"));
var path = require("path");
var Exec = require("./exec");
var ConfigurationError = require('./errors/configurationerror');
var Pudding = require("ether-pudding");
var PuddingLoader = require("ether-pudding/loader");

var Config = {
  gather(truffle_dir, working_dir, argv, desired_environment) {
    var config = {};
    config = _.merge(config, {
      argv: argv,
      truffle_dir: truffle_dir,
      working_dir: working_dir,
      web3: new Web3(),
      environments: {
        directory: `${working_dir}/environments`,
        available: {},
        current: {}
      },
      app: {
        configfile: path.join(working_dir, "truffle.js"),
        oldconfigfile: path.join(working_dir, "truffle.json"),
        directory: path.join(working_dir, "app"),
        // Default config objects that'll be overwritten by working_dir config.
        resolved: {
          build: {},
          include_contracts: true,
          deploy: [],
          after_deploy: [],
          rpc: {},
          processors: {},
        }
      },
      example: {
        directory: `${truffle_dir}/example`
      },
      templates: {
        test: {
          filename: path.join(truffle_dir, "templates", "example.js"),
          variable: "example"
        },
        contract: {
          filename: path.join(truffle_dir, "templates", "Example.sol"),
          name: "Example",
          variable: "example"
        }
      },
      contracts: {
        classes: {},
        directory: `${working_dir}/contracts`,
        build_directory: null
      },
      tests: {
        directory: `${working_dir}/test`
      },
      build: {
        directory: null,
      },
      dist: {
        directory: null,
      }
    });

    // Check to see if we're working on a dapp meant for 0.2.x or older
    if (fs.existsSync(path.join(working_dir, "config", "app.json"))) {
      console.log("Your dapp is meant for an older version of Truffle. Don't worry, there are two solutions!")
      console.log("");
      console.log("1) Upgrade you're dapp using the followng instructions (it's easy):");
      console.log("   https://github.com/ConsenSys/truffle/wiki/Migrating-from-v0.2.x-to-v0.3.0");
      console.log("");
      console.log("   ( OR )")
      console.log("");
      console.log("2) Downgrade to Truffle 0.2.x");
      console.log("");
      console.log("Cheers! And file an issue if you run into trouble! https://github.com/ConsenSys/truffle/issues")
      process.exit();
    }

    config.requireNoCache = function(filePath) {
      //console.log("Requring w/o cache: " + path.resolve(filePath));
    	delete require.cache[path.resolve(filePath)];
    	return require(filePath);
    };

    desired_environment = argv.e || argv.environment || process.env.NODE_ENV || desired_environment;

    // Try to find the desired environment, and fall back to development if we don't find it.
    for (var environment of [desired_environment, "development"]) {
      var environment_directory = `${config.environments.directory}/${environment}`;
      if (!fs.existsSync(environment_directory)) {
        continue;
      }

      // I put this warning here but now I'm not sure if I want it.
      if (environment != desired_environment && desired_environment != null) {
        console.log(`Warning: Couldn't find environment ${desired_environment}.`);
      }

      config.environment = desired_environment;
      config.environments.current.directory = environment_directory;
      config.environments.current.filename = path.join(environment_directory, "config.json");

      break;
    }

    // If we didn't find an environment, but asked for one, error.
    if (config.environment == null && desired_environment != null) {
      throw new ConfigurationError("Couldn't find any suitable environment. Check environment configuration.");
    }

    // Get environments in working directory, if available.
    if (fs.existsSync(config.environments.directory)) {
      for (var directory of subdirSync(config.environments.directory)) {
        name = directory.substring(directory.lastIndexOf("/") + 1)
        config.environments.available[name] = directory;
      }
    }

    // Load the app config.
    // For now, support both new and old config files.
    if (fs.existsSync(config.app.configfile)) {
      _.merge(config.app.resolved, config.requireNoCache(config.app.configfile));
    } else if (fs.existsSync(config.app.oldconfigfile)) {
      config.app.resolved = loadconf(config.app.oldconfigfile, config.app.resolved);
    }

    // Now overwrite any values from the environment config.
    if (fs.existsSync(config.environments.current.filename)) {
      config.app.resolved = loadconf(config.environments.current.filename, config.app.resolved);
    }

    if (fs.existsSync(config.environments.current.directory)) {
      // Overwrite build and dist directories
      config.build.directory = path.join(config.environments.current.directory, "build");
      config.dist.directory = path.join(config.environments.current.directory, "dist");
      config.contracts.build_directory = path.join(config.environments.current.directory, "contracts");
    }

    // Allow for deprecated build configuration.
    if (config.app.resolved.frontend != null) {
      config.app.resolved.build = config.app.resolved.frontend;
    }

    // Helper function for expecting paths to exist.
    config.expect = function(expected_path, description = "file", extra = "", callback) {
      if (typeof description == "function") {
        callback = description;
        description = "file";
        extra = "";
      }

      if (typeof extra == "function") {
        callback = extra;
        extra = "";
      }

      if (!fs.existsSync(expected_path)) {
        var display_path = expected_path.replace(this.working_dir, "./");
        var error = new ConfigurationError(`Couldn't find ${description} at ${display_path}. ${extra}`);

        if (callback != null) {
          callback(error);
          return false;
        } else {
          throw error;
        }
      }
      return true;
    };

    config.test_connection = function(callback) {
      config.web3.eth.getCoinbase(function(error, coinbase) {
        if (error != null) {
          error = new Error("Could not connect to your RPC client. Please check your RPC configuration.");
        }

        callback(error, coinbase)
      });
    };

    // DEPRECATED: Resolve paths for default builder's extra processors.
    for (var extension in config.app.resolved.processors) {
      var file = config.app.resolved.processors[extension];
      var full_path = path.join(working_dir, file);
      config.app.resolved.processors[extension] = full_path;
    }

    var provider = new Web3.providers.HttpProvider(`http://${config.app.resolved.rpc.host}:${config.app.resolved.rpc.port}`);
    config.web3.setProvider(provider);

    if (argv.verboseRpc != null) {
      // // If you want to see what web3 is sending and receiving.
      var oldAsync = config.web3.currentProvider.sendAsync;
      config.web3.currentProvider.sendAsync = function(options, callback) {
        console.log("   > " + JSON.stringify(options, null, 2).split("\n").join("\n   > "));
        oldAsync.call(config.web3.currentProvider, options, function(error, result) {
          if (error == null) {
            console.log(" <   " + JSON.stringify(result, null, 2).split("\n").join("\n <   "));
          }
          callback(error, result)
        });
      };
    }

    // Get contracts in working directory, if available.
    if (fs.existsSync(config.contracts.directory)) {
      for (file of filesSync(config.contracts.directory)) {
        var name = file.substring(file.lastIndexOf("/") + 1, file.lastIndexOf("."));
        var relative_path = file.replace(config.working_dir, "./");
        config.contracts.classes[name] = {
          source: relative_path
        }
      }
    }

    // Now merge those contracts with what's in the configuration, if any, using the loader.
    Pudding.setWeb3(config.web3);

    if (fs.existsSync(config.contracts.build_directory)) {
      var loader = deasync(PuddingLoader.load);
      var contracts = {};

      var names = loader(config.contracts.build_directory, Pudding, contracts);

      for (var name of names) {
        // Don't load a contract that's been deleted.
        if (!config.contracts.classes[name]) {
          continue;
        }

        var contract = contracts[name];
        config.contracts.classes[name].abi = contract.prototype.abi;
        config.contracts.classes[name].binary = contract.prototype.binary;
        config.contracts.classes[name].address = contract.prototype.address;
      }
    }

    return config;
  }
}

module.exports = Config;
