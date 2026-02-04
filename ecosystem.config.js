const os = require('os');

module.exports = {
    apps : [{
        name: "colyseus-app",
        script: 'build/src/index.js',
        time: true,
        watch: false,
        instances: os.cpus().length,
        exec_mode: 'fork',
        wait_ready: true,
    }],
};
