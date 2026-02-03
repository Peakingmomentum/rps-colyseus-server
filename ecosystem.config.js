const os = require('os');

module.exports = {
    apps : [{
        name: "colyseus-app",
        script: 'build/arena.config.js',
        time: true,
        watch: false,
        instances: os.cpus().length,
        exec_mode: 'fork',
        wait_ready: true,
    }],
};
