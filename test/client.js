// A reusable test suite to verify the client implementation
var should = require("chai").should();
var url = require("url");
var http = require("http");
var querystring = require("querystring");
var react = require("../lib/index");

http.globalAgent.maxSockets = Infinity;

describe("client", function() {
    // Increase timeout for Internet Explorer 6-8
    this.timeout(10000);
    
    before(function(done) {
        var self = this;
        // A container for active socket to close them after each test
        var sockets = [];
        var server = react.server().on("socket", function(socket) {
            sockets.push(socket);
            // Remove the closed one
            socket.on("close", function() {
                sockets.splice(sockets.indexOf(socket), 1);
            });
        });
        
        // A container for active net socket to destroy them after the whole suite
        var netSockets = [];
        var httpServer = http.createServer().on("connection", function(socket) {
            netSockets.push(socket);
            // Remove the closed one
            socket.on("close", function () {
                netSockets.splice(netSockets.indexOf(socket), 1);
            });
        });
        // Install a react server on a web server
        httpServer.on("request", function(req, res) {
            if (url.parse(req.url).pathname === "/react") {
                server.handleRequest(req, res);
            }
        })
        .on("upgrade", function(req, sock, head) {
            if (url.parse(req.url).pathname === "/react") {
                server.handleUpgrade(req, sock, head);
            }
        });
        // Start the web server
        httpServer.listen(0, function() {
            var port = this.address().port;
            // This method is to tell client to connect this server 
            self.order = function(params) {
                params.uri = "http://localhost:" + port + "/react";
                params.heartbeat = params.heartbeat || false;
                params._heartbeat = params._heartbeat || false;
                http.get("http://localhost:9000/open?" + querystring.stringify(params));
            };
            done();
        });
        
        self.sockets = sockets;
        self.server = server;
        self.netSockets = netSockets;
        self.httpServer = httpServer;
    });
    beforeEach(function() {
        // To restore the original stack
        this.socketListeners = this.server.listeners("socket");
    });
    afterEach(function() {
        // Disconnect sockets used in test
        this.sockets.forEach(function(socket) {
            socket.close();
        });
        // Remove the listener added by the test and restore the original stack
        this.server.removeAllListeners("socket");
        this.socketListeners.forEach(function(listener) {
            this.server.on("socket", listener);
        }.bind(this));
    });
    after(function(done) {
        // To shutdown the web server immediately
        setTimeout(function() {
            this.netSockets.forEach(function(socket) {
                socket.destroy();
            });
            this.httpServer.close(function() {
                done();   
            });
        }.bind(this), 10);
    });
    
    describe("transport", function() {
        // TODO exclude test considering transport's quirks
        function suite(transport) {
            describe("open", function() {
                it("should open a new socket", function(done) {
                    this.order({transport: transport});
                    this.server.on("socket", function() {
                        done();
                    });
                });
            });
            describe("close", function() {
                // Some old browser's transports can't pass so they have to use heartbeat
                it("should close the socket if the server requests it", function(done) {
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        socket.on("close", function() {
                            done();
                        })
                        .close();
                    });
                });
                it("should close the socket if the client requests it", function(done) {
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        socket.on("close", function() {
                            done();
                        })
                        .send("abort");
                    });
                });
            });
            describe("exchange", function() {
                it("should exchange an event", function(done) {
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        socket.on("echo", function(data) {
                            data.should.be.equal("data");
                            done();
                        })
                        .send("echo", "data");
                    });
                });
                it("should exchange an event containing of multi-byte characters", function(done) {
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        socket.on("echo", function(data) {
                            data.should.be.equal("라면");
                            done();
                        })
                        .send("echo", "라면");
                    });
                });
                it("should exchange an event of 2KB", function(done) {
                    var text2KB = Array(2048).join("K");
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        socket.on("echo", function(data) {
                            data.should.be.equal(text2KB);
                            done();
                        })
                        .send("echo", text2KB);
                    });
                });
                it("should not lose any event in an exchange of one hundred of event", function(done) {
                    var timer, sent = [], received = [];
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        socket.on("echo", function(i) {
                            received.push(i);
                            clearTimeout(timer);
                            timer = setTimeout(function() {
                                received.sort();
                                received.should.be.deep.equal(sent);
                                done();
                            // Increase timeout for Internet Explorer 6-8
                            }, 1000);
                        });
                        for (var i = 0; i < 100; i++) {
                            sent.push(i);
                            socket.send("echo", i);
                        }
                        sent.sort();
                    });
                });
            });
            describe("reply", function() {
                it("should handle reply requested by the client", function(done) {
                    this.order({transport: transport});
                    this.server.on("socket", function(socket) {
                        function fail() { true.should.be.false; }
                        socket.send("reaction", true, function(value) {
                            value.should.be.true;
                            socket.send("reaction", false, fail, function(reason) {
                                reason.should.be.false;
                                done();
                            });
                        }, fail);
                    });
                });
            });
            describe("heartbeat", function() {
                it("should support heartbeat", function(done) { 
                    this.order({transport: transport, heartbeat: 400, _heartbeat: 200});
                    this.server.on("socket", function(socket) {
                        socket.once("heartbeat", function() {
                            this.once("heartbeat", function() {
                                this.once("heartbeat", function() {
                                    done();
                                }); 
                            });
                        });
                    });
                });
                it("should close the socket if heartbeat fails", function(done) {
                    this.order({transport: transport, heartbeat: 400, _heartbeat: 200});
                    this.server.on("socket", function(socket) {
                        socket.send = function() { return this; };
                        socket.on("close", function() {
                            done();
                        });
                    });
                });
            });
        }
        
        "ws sse streamxhr streamxdr streamiframe longpollajax longpollxdr longpolljsonp".split(" ").forEach(function(transport) {
            describe(transport, function() {
                suite(transport);
            });
        });
    });
});