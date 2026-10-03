package host

import "testing"

func TestJobsNeedExternalPowerAndAnOpenLid(t *testing.T) {
	cases := []struct {
		power Power
		want  bool
	}{
		{Power{}, true},
		{Power{OnBattery: true}, false},
		{Power{LidClosed: true}, false},
		{Power{OnBattery: true, LidClosed: true}, false},
	}
	for _, c := range cases {
		if got := c.power.Available(); got != c.want {
			t.Errorf("%+v: Available() = %v, want %v", c.power, got, c.want)
		}
	}
}
