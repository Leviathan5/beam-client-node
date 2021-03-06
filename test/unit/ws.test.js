var Bluebird = require('bluebird');
var expect = require('chai').expect;
var sinon = require('sinon');
var events = require('events');

describe('websocket', function () {
    var BeamSocket = require('../../lib/ws');
    var factory = require('../../lib/ws/factory');
    var errors = require('../../lib/errors');
    var socket, raw, factoryStub;

    beforeEach(function () {
        raw = new events.EventEmitter();
        raw.close = sinon.spy();
        raw.send = sinon.spy();

        socket = new BeamSocket(['a', 'b']);
        socket.ws = raw;

        factoryStub = sinon.stub(factory, 'create').returns(raw);
    });

    afterEach(function () {
        factoryStub.restore();
    });

    it('balances requests', function () {
        for (var i = []; i.length < 5;) i.push(socket.getAddress());
        if (i[0] === 'a') i = i.slice(1);
        expect(i.slice(0, 4)).to.deep.equal(['b', 'a', 'b', 'a']);
    });

    it('gets status and connected correctly', function () {
        expect(socket.getStatus()).to.equal(BeamSocket.IDLE);
        expect(socket.isConnected()).to.be.false;
        socket.status = BeamSocket.CONNECTED;
        expect(socket.isConnected()).to.be.true;
    });

    it('closes the websocket connection', function () {
        socket.close();
        expect(raw.close.called).to.be.true;
    });

    describe('sending', function () {
        var data = { foo: 'bar' };

        it('sends events when connected', function (done) {
            sinon.stub(socket, 'isConnected').returns(true);
            socket.on('sent', function (data) {
                expect(raw.send.calledWith('{"foo":"bar"}')).to.be.true;
                expect(data).to.deep.equal(data);
                done();
            });

            socket.send(data);
        });

        it('spools when not connected', function (done) {
            sinon.stub(socket, 'isConnected').returns(false);
            socket.on('spooled', function (data) {
                expect(raw.send.called).to.be.false;
                expect(socket.spool).to.deep.equal([data]);
                done();
            });

            socket.send(data);
        });

        it('sends events when not connected but forced', function (done) {
            sinon.stub(socket, 'isConnected').returns(false);
            socket.on('sent', function (data) {
                expect(raw.send.calledWith('{"foo":"bar"}')).to.be.true;
                expect(data).to.deep.equal(data);
                done();
            });

            socket.send(data, { force: true });
        });
    });

    describe('packet parsing', function () {
        var evPacket = '{"type":"event","event":"UserJoin","data":{"username":"connor4312","role":"Owner","id":146}}';
        var authPacket = '{"type":"reply","error":null,"id":1,"data":{"authenticated":true,"role":"Owner"}}';

        it('fails to parse binary', function (done) {
            socket.on('error', function (err) {
                expect(err).to.be.an.instanceof(errors.BadMessageError);
                done();
            });
            socket.parsePacket(evPacket, { binary: true });
        });

        it('fails to parse invalid json', function (done) {
            socket.on('error', function (err) {
                expect(err).to.be.an.instanceof(errors.BadMessageError);
                done();
            });
            socket.parsePacket('lel', { binary: false });
        });

        it('fails to parse bad type', function (done) {
            socket.on('error', function (err) {
                expect(err).to.be.an.instanceof(errors.BadMessageError);
                done();
            });
            socket.parsePacket('{"type":"silly"}', { binary: false });
        });

        it('parses event correctly', function (done) {
            socket.on('UserJoin', function (data) {
                expect(data).to.deep.equal({ username: 'connor4312', role: 'Owner', id: 146 });
                done();
            });

            socket.parsePacket(evPacket, { binary: false });
        });

        it('throws error on replies with no handler', function (done) {
            socket.on('error', function (err) {
                expect(err).to.be.an.instanceof(errors.NoMethodHandlerError);
                done();
            });
            socket.parsePacket(authPacket, { binary: false });
        });

        it('passes replies to handlers and deletes handler', function () {
            var spy = socket.replies[1] = { handle: sinon.spy() };
            socket.parsePacket(authPacket, { binary: false });
            expect(socket.replies[1]).to.be.undefined;
            expect(spy.handle.calledWith(JSON.parse(authPacket))).to.be.true;
        });
    });

    describe('unspooling', function () {

        beforeEach(function () {
            socket.spool = ['foo', 'bar'];
        });

        it('connects directly if no previous auth packet', function (done) {
            socket.on('connected', function () {
                expect(raw.send.calledWith('"foo"')).to.be.true;
                expect(raw.send.calledWith('"bar"')).to.be.true;
                expect(socket.spool.length).to.equal(0);
                expect(socket.isConnected()).to.be.true;
                done();
            });

            expect(socket.isConnected()).to.be.false;
            socket.unspool();
        });

        it('tries to auth successfully', function (done) {
            socket.on('connected', function () {
                expect(socket.isConnected()).to.be.true;
                expect(stub.calledWith('auth', [1, 2, 3], { force: true })).to.be.true;
                done();
            });

            var stub = sinon.stub(socket, 'call').returns(Bluebird.resolve());
            socket.authpacket = [1, 2, 3];
            socket.unspool();
        });

        it('tries to auth rejects unsuccessful', function (done) {
            socket.on('error', function (err) {
                expect(err).to.be.an.instanceof(errors.AuthenticationFailedError);
                done();
            });

            var stub = sinon.stub(socket, 'call').returns(Bluebird.reject());
            socket.authpacket = [1, 2, 3];
            socket.unspool();
        });
    });

    describe('method calling', function () {
        beforeEach(function () {
            socket.status = BeamSocket.CONNECTED;
            sinon.stub(socket, 'send');
        });

        it('sends basic with no reply or args', function () {
            socket.call('foo', { noReply: true });
            expect(socket.send.calledWith(
                { type: 'method', method: 'foo', arguments: [], id: 0 }, { noReply: true }
            )).to.be.true;
        });

        it('increments the call ID', function () {
            for (var i = 0; i < 10; i++) {
                socket.call('foo', { noReply: true });
                expect(socket.send.calledWith({ type: 'method', method: 'foo', arguments: [], id: i })).to.be.true;
            }
        });

        it('saves the auth packet', function () {
            socket.call('auth', [1, 2, 3], { noReply: true });
            expect(socket.authpacket).to.deep.equal([1, 2, 3]);
        });

        it('registers the reply with resolved response', function (done) {
            socket.call('foo', [1, 2, 3]).then(function (data) {
                expect(data).to.deep.equal({ authenticated: true, role: "Owner" });
                done();
            });
            socket.parsePacket(JSON.stringify({
                type: 'reply',
                error: null,
                id: 0,
                data: { authenticated: true, role: 'Owner' }
            }));
        });

        it('registers the reply with rejected response', function (done) {
            socket.call('foo', [1, 2, 3]).catch(function (err) {
                expect(err).to.equal('foobar');
                done();
            });
            socket.parsePacket(JSON.stringify({
                type: 'reply',
                error: 'foobar',
                id: 0,
                data: null
            }));
        });

        it('quietly removes the reply after a timeout', function () {
            var clock = sinon.useFakeTimers();
            socket.call('foo', [1, 2, 3]);
            expect(socket.replies[0]).to.be.defined;
            clock.tick(5001);
            expect(socket.replies[0]).not.to.be.defined;
            clock.restore();
        });
    });
});
