#!/usr/bin/env ./node_modules/.bin/babel-node
require("coffee-script/register");

var web3 = require("web3");
var path = require("path");
var fs = require("fs");
var gaze = require('gaze');
var deasync = require("deasync");
var colors = require('colors/safe');
var Init = require("./lib/init");
var Create = require("./lib/create");
var Config = require("./lib/config");
var Contracts = require("./lib/contracts");
var Build = require("./lib/build");
var Test = require("./lib/test");
var Exec = require("./lib/exec");
var Repl = require("./lib/repl");
var Serve = require("./lib/serve");

var ConfigurationError = require("./lib/errors/configurationerror");
var ExtendableError = require("./lib/errors/extendableerror");

var argv = require('yargs').argv;

var truffle_dir = process.env.TRUFFLE_NPM_LOCATION || argv.n || argv.npm_directory;
var working_dir = process.env.TRUFFLE_WORKING_DIRECTORY || argv.w || argv.working_directory;

if (working_dir[working_dir.length - 1] != "/") {
  working_dir += "/";
}

var pkg = JSON.parse(fs.readFileSync(path.join(truffle_dir, "package.json"), {encoding: "utf8"}));

var tasks = {};
var registerTask = function(name, description, fn) {
  tasks[name] = {
    name: name,
    description: description,
    fn: fn
  };
}

var printSuccess = function() {
  console.log(colors.green(`Completed without errors on ${new Date().toString()}`));
};

var printFailure = function() {
  console.log(colors.red(`Completed with errors on ${new Date().toString()}`));
};

var runTask = function(name) {
  try {
    var fn = deasync(tasks[name].fn);
    fn();
    return 0;
  } catch (e) {
    if (e instanceof ExtendableError) {
      console.log(e.message);

      if (argv.stack != null) {
        console.log(e.stack);
      }

    } else {
      // Bubble up all other unexpected errors.
      console.log(e.stack || e.toString());
    }
    return 1;
  }
};

registerTask('watch', "Watch filesystem for changes and rebuild the project automatically", function(done) {
  var needs_rebuild = true;
  var needs_redeploy = false;

  gaze(["app/**/*", "environments/*/contracts/**/*", "contracts/**/*"], {cwd: working_dir, interval: 1000, debounceDelay: 500}, function() {
    // On changed/added/deleted
    this.on('all', function(event, filePath) {
      var display_path = path.join("./", filePath.replace(working_dir, ""));
      console.log(colors.cyan(`>> File ${display_path} changed.`));

      needs_rebuild = true;

      if (display_path.indexOf("contracts/") == 0) {
        needs_redeploy = true;
      } else {
        needs_rebuild = true;
      }
    });
  });

  var check_rebuild = function() {
    if (needs_redeploy == true) {
      needs_redeploy = false;
      needs_rebuild = false;
      console.log("Redeploying...");
      if (runTask("deploy") != 0) {
        printFailure();
      }
    }

    if (needs_rebuild == true) {
      needs_rebuild = false;
      console.log("Rebuilding...");
      if (runTask("build") != 0) {
        printFailure();
      }
    }

    setTimeout(check_rebuild, 500);
  };

  setInterval(check_rebuild, 500);
});

registerTask('list', "List all available tasks", function(done) {
  console.log("Truffle v" + pkg.version + " - a development framework for Ethereum");
  console.log("");
  console.log("Usage: truffle [command] [options]");
  console.log("");
  console.log("Commands:");
  console.log("");

  var sorted = Object.keys(tasks).sort();

  var longestTask = sorted.reduce(function(a, b) {
    var first = typeof a == "string" ? a.length : a;
    return Math.max(first, b.length);
  });

  for (var i = 0; i < sorted.length; i++) {
    var task = tasks[sorted[i]];
    var heading = task.name;
    while (heading.length < longestTask) {
      heading += " ";
    }
    console.log("  " + heading + " => " + task.description)
  }

  console.log("");
  done();
});

registerTask('version', "Show version number and exit", function(done) {
  console.log("Truffle v" + pkg.version);
  done();
});

registerTask('init', "Initialize new Ethereum project, including example contracts and tests", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv);
  Init.all(config, done);
});

registerTask('create:contract', "Create a basic contract", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv);

  var name = argv.name;

  if (name == null && argv._.length > 1) {
    name = argv._[1];
  }

  if (name == null) {
    throw new ConfigurationError("Please specify a name. Example: truffle create:contract MyContract");
  } else {
    Create.contract(config, name, done);
  }
});

registerTask('create:test', "Create a basic test", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv);

  var name = argv.name;

  if (name == null && argv._.length > 1) {
    name = argv._[1];
  }

  if (name == null) {
    throw new ConfigurationError("Please specify a name. Example: truffle create:test MyTest");
  } else {
    Create.test(config, name, done);
  }
});

registerTask('resolve', "Resolve dependencies in contract file and print result", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "development");

  var file = argv.file;

  if (file == null && argv._.length > 1) {
    file = argv._[1];
  }

  if (file == null) {
    throw new ConfigurationError("Please specify a contract file. Example: truffle resolve ./contracts/Example.sol");
  } else {
    file = path.resolve(file);

    var code;

    try {
      code = Contracts.resolve(file);
    } catch (e) {
      done(e);
      return;
    }

    console.log(code);
    done();
  }
});

registerTask('compile', "Compile contracts", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "development");
  Contracts.compile(config, done);
});

registerTask('deploy', "Deploy contracts to the network", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "development");

  console.log("Using environment " + config.environment + ".");

  var compile = true;

  if (argv.compile === false) {
    compile = false;
  }

  // Compile and deploy.
  Contracts.deploy(config, compile, function(err) {
    if (err != null) {
      done(err);
    } else {
      // console.log("Rebuilding app with new contracts...");
      // runTask("build");
      done();
    }
  });
});

registerTask('build', "Build development version of app", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "development");
  Build.build(config, function(err) {
    done(err);
    if (err == null) {
      printSuccess();
    }
  });
});

registerTask('dist', "Create distributable version of app (minified)", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "production");
  console.log("Using environment " + config.environment + ".");
  Build.dist(config, function(err) {
    done(err);
    if (err == null) {
      printSuccess();
    }
  });
});

registerTask('exec', "Execute a Coffee/JS file within truffle environment. Script *must* call process.exit() when finished.", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "development");

  var file = argv.file;

  if (file == null && argv._.length > 1) {
    file = argv._[1];
  }

  if (file == null) {
    console.log("Please specify a file, passing the path of the script you'd like the run. Note that all scripts *must* call process.exit() when finished.");
    done();
    return;
  }

  Exec.file(config, file, done);
});

// Supported options:
// --no-color: Disable color
// More to come.
registerTask('test', "Run tests", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "test");

  console.log("Using environment " + config.environment + ".");

  // Ensure we're quiet about deploys during tests.
  config.argv.quietDeploy = true;

  var file = argv.file;

  if (file == null && argv._.length > 1) {
    file = argv._[1];
  }

  if (file == null) {
    Test.run(config, done);
  } else {
    Test.run(config, file, done);
  }
});

registerTask('console', "Run a console with deployed contracts instanciated and available (REPL)", function(done) {
  var config = Config.gather(truffle_dir, working_dir, argv, "development");
  Repl.run(config, done);
});


// Supported options:
// --server=server.js : Use 'server.js' as server file (has to implement a startup function 'start')
registerTask('serve', "Serve app on http://localhost:8080 and rebuild changes as needed", function(done) {
    var config = Config.gather(truffle_dir, working_dir, argv, "development");
    console.log("Using environment " + config.environment + ".");
    if (argv.server) {
	try {
	    var server = require(path.join(working_dir, argv.server));
	}
	catch (e) {
	    console.log(argv.server, "does not exists, aborting.");
	    done();
	    return ;
	}
	server.start(config, function() {
	    runTask("watch");
	});
    }
    else {
    Serve.start(config, function() {
	runTask("watch");
    });
    }
});



// registerTask('watch:tests', "Watch filesystem for changes and rerun tests automatically", function(done) {
//
//   gaze(["app/**/*", "config/**/*", "contracts/**/*", "test/**/*"], {cwd: working_dir, interval: 1000, debounceDelay: 500}, function() {
//     // On changed/added/deleted
//     this.on('all', function(event, filePath) {
//       if (filePath.match(/\/config\/.*?\/.*?\.sol\.js$/)) {
//         // ignore changes to /config/*/*.sol.js since these changes every time
//         // tests are run (when contracts are compiled)
//         return;
//       }
//       process.stdout.write("\u001b[2J\u001b[0;0H"); // clear screen
//       var display_path = "./" + filePath.replace(working_dir, "");
//       console.log(colors.cyan(`>> File ${display_path} changed.`));
//       run_tests();
//     });
//   });
//
//   var run_tests = function() {
//     console.log("Running tests...");
//
//     process.chdir(working_dir);
//     var config = Config.gather(truffle_dir, working_dir, argv, "test");
//     config.argv.quietDeploy = true; // Ensure we're quiet about deploys during tests
//
//     Test.run(config, function() { console.log("> test run complete; watching for changes..."); });
//   };
//   run_tests(); // run once immediately
//
// });


// Default to listing available commands.
var current_task = argv._[0];

if (current_task == null) {
  current_task = "list";
}

if (tasks[current_task] == null) {
  console.log(colors.red("Unknown command: " + current_task));
  process.exit(1);
}

// Something is keeping the process open. I'm not sure what.
// Let's explicitly kill it until I can figure it out.
process.exit(runTask(current_task));
//runTask(current_task);
