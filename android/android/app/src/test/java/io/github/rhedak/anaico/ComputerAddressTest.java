package io.github.rhedak.anaico;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

public class ComputerAddressTest {

    @Test
    public void bareAddressGetsTheDefaultPort() {
        ComputerAddress c = ComputerAddress.parse("192.168.1.9");
        assertEquals("192.168.1.9", c.host);
        assertEquals(3737, c.port);
        assertEquals("192.168.1.9:3737", c.display());
        assertEquals("http://192.168.1.9:3737/", c.origin());
    }

    @Test
    public void addressWithPortAndPairingLinkAreAccepted() {
        ComputerAddress c = ComputerAddress.parse("http://192.168.1.9:35479/pair?e=abc");
        assertEquals(35479, c.port);
        assertEquals("192.168.1.9:35479", c.display());
    }

    @Test
    public void tailscaleAndBonjourNamesAreAccepted() {
        assertEquals("100.100.1.2", ComputerAddress.parse("100.100.1.2:3737").host);
        assertEquals("mac.local", ComputerAddress.parse("Mac.LOCAL:3737").host);
    }

    @Test
    public void privateRangesEdgesAreRight() {
        assertTrue(ComputerAddress.isPrivateHost("10.0.0.1"));
        assertTrue(ComputerAddress.isPrivateHost("172.16.0.1"));
        assertTrue(ComputerAddress.isPrivateHost("172.31.255.255"));
        assertTrue(ComputerAddress.isPrivateHost("100.64.0.1"));
        assertTrue(ComputerAddress.isPrivateHost("100.127.255.255"));
        assertFalse(ComputerAddress.isPrivateHost("172.15.0.1"));
        assertFalse(ComputerAddress.isPrivateHost("172.32.0.1"));
        assertFalse(ComputerAddress.isPrivateHost("100.63.0.1"));
        assertFalse(ComputerAddress.isPrivateHost("100.128.0.1"));
        assertFalse(ComputerAddress.isPrivateHost("8.8.8.8"));
        assertFalse(ComputerAddress.isPrivateHost("127.0.0.1"));
        assertFalse(ComputerAddress.isPrivateHost("169.254.1.1"));
        assertFalse(ComputerAddress.isPrivateHost("0.0.0.0"));
    }

    @Test
    public void publicAndLoopbackNamesAreRefused() {
        assertRefused("example.com");
        assertRefused("localhost");
        assertRefused("localhost:3737");
        assertRefused("computer");
        assertRefused("[::1]:3737");
        assertRefused("8.8.8.8:3737");
        assertRefused("127.0.0.1:3737");
    }

    @Test
    public void otherSchemesAndCredentialsAreRefused() {
        assertRefused("https://192.168.1.9:3737");
        assertRefused("ftp://192.168.1.9");
        assertRefused("http://user:secret@192.168.1.9:3737");
    }

    @Test
    public void emptyAndBadInputIsRefused() {
        assertRefused("");
        assertRefused("   ");
        assertRefused(null);
        assertRefused("http://[");
    }

    @Test
    public void badOctetIsRefused() {
        assertRefused("192.168.1.999");
    }

    private static void assertRefused(String input) {
        try {
            ComputerAddress.parse(input);
            fail("expected refusal for: " + input);
        } catch (IllegalArgumentException expected) {
            assertTrue(expected.getMessage() != null && !expected.getMessage().isEmpty());
        }
    }
}
