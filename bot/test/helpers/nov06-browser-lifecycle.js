'use strict';

function closeTestServer(server) {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        // Only this fixture's sockets; never wait on a browser's partial request.
        server.closeAllConnections();
    });
}

module.exports = { closeTestServer };
